#!/bin/bash
#
# My GeekTime 项目启动脚本
#
# 用法:
#   ./scripts/start.sh          # 启动全部服务
#   ./scripts/start.sh db       # 仅启动数据库
#   ./scripts/start.sh server   # 仅启动应用服务 (需先启动 db)
#   ./scripts/start.sh build    # 编译并启动
#   ./scripts/start.sh stop     # 停止全部服务
#

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
step()  { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

CONFIG="${CONFIG:-custom_config.yaml}"
DOCKER_COMPOSE="docker compose -f docker/docker-compose.yml"

# ---- Functions ----

start_db() {
    step "启动 PostgreSQL"
    $DOCKER_COMPOSE up -d postgres
    info "等待 PostgreSQL 就绪..."
    for i in $(seq 1 30); do
        if $DOCKER_COMPOSE exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
            info "PostgreSQL 已就绪"
            return 0
        fi
        sleep 2
    done
    error "PostgreSQL 启动超时"
    return 1
}

stop_db() {
    step "停止 PostgreSQL"
    $DOCKER_COMPOSE down
    info "PostgreSQL 已停止"
}

build_server() {
    step "编译项目"
    go vet ./...
    go build -ldflags \
        "-s -w -X main.buildTime=$(date +%Y%m%d.%H%M%S) -X main.buildCommit=$(git rev-parse --short=12 HEAD 2>/dev/null || echo 'unknown') -X main.buildBranch=$(git branch --show-current 2>/dev/null || echo 'unknown')" \
        -o mygeektime .
    info "编译完成: mygeektime"
}

start_server() {
    step "启动应用服务"
    if [ ! -f "$CONFIG" ]; then
        warn "配置文件 $CONFIG 不存在，使用默认配置"
        CONFIG=""
    fi
    if [ -n "$CONFIG" ]; then
        ./mygeektime server --config="$CONFIG"
    else
        ./mygeektime server
    fi
}

stop_server() {
    step "停止应用服务"
    pkill -f "./mygeektime server" 2>/dev/null && info "应用服务已停止" || warn "应用服务未运行"
}

check_prerequisites() {
    # 检查必要工具
    for cmd in go docker; do
        if ! command -v "$cmd" &>/dev/null; then
            error "$cmd 未安装"
            return 1
        fi
    done

    # 检查 Docker daemon
    if ! docker info &>/dev/null; then
        error "Docker daemon 未运行"
        return 1
    fi
}

# ---- Main ----

case "${1:-all}" in
    db)
        check_prerequisites
        start_db
        ;;
    server)
        start_server
        ;;
    build)
        check_prerequisites
        build_server
        ;;
    stop)
        stop_server
        stop_db
        ;;
    all)
        check_prerequisites
        start_db
        build_server
        start_server
        ;;
    migrate)
        check_prerequisites
        if [ ! -f "mygeektime.db" ]; then
            warn "SQLite 文件 mygeektime.db 不存在，跳过迁移"
        else
            step "数据库迁移: SQLite → PostgreSQL"
            go run cmd/migrate/main.go
        fi
        ;;
    cache-all)
        # 缓存全部体系课 (调用 API 批量提交)
        TOKEN="${2:-}"
        COOKIE="${3:-}"
        DOWNLOAD_VIDEO="${4:-true}"
        DOWNLOAD_AUDIO="${5:-true}"
        BASE_URL="http://127.0.0.1:8090"
        GK_API="https://time.geekbang.org/serv/v4/pvip/product_list"

        if [ -z "$TOKEN" ]; then
            read -rp "请输入登录 Token: " TOKEN
        fi
        if [ -z "$COOKIE" ]; then
            read -rp "请输入极客时间 Cookie: " COOKIE
        fi

        step "刷新 Cookie 凭证"
        curl -s -X POST "$BASE_URL/v2/base/refresh/cookie" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"cookie\": \"$COOKIE\"}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'  Status: {d.get(\"status\")}, Msg: {d.get(\"msg\",\"\")}')
if d.get('status') != 0:
    sys.exit(1)
" 2>&1 || { error "Cookie 刷新失败"; exit 1; }
        info "Cookie 凭证已刷新"

        step "获取体系课列表 (全量，直接从极客时间 API 获取)"
        PAGE=1
        ALL_IDS=()
        while true; do
            step "  → 请求第 ${PAGE} 页..."
            # 直接调用极客时间 API，避免本地 30 秒超时限制
            RESP=$(curl -s --max-time 120 \
                -X POST "$GK_API" \
                -H "Accept: application/json, text/plain, */*" \
                -H "Content-Type: application/json" \
                -H "Cookie: $COOKIE" \
                -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
                -H "Origin: https://time.geekbang.org" \
                -H "Referer: https://time.geekbang.org/" \
                -d "{\"prev\":$PAGE,\"size\":100,\"product_type\":0,\"sort\":8}")
            ROWS=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); products=d.get('data',{}).get('products',[]); print(len(products))" 2>/dev/null || echo "0")
            [ "$ROWS" = "0" ] && break
            IDS=$(echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
products = d.get('data',{}).get('products',[]) or []
for p in products:
    print(p.get('id',''))
" 2>/dev/null)
            while IFS= read -r id; do
                [ -n "$id" ] && ALL_IDS+=("$id")
            done <<< "$IDS"
            PAGE=$((PAGE + 1))
            sleep 1
        done
        info "共获取 ${#ALL_IDS[@]} 个课程"

        step "查询已有任务，过滤重复"
        TASK_RESP=$(curl -s --max-time 30 "$BASE_URL/v2/task/list?perPage=10000" \
            -H "Authorization: Bearer $TOKEN")
        EXISTING_IDS=$(echo "$TASK_RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
rows = d.get('data',{}).get('rows',[]) or d.get('rows',[])
for r in rows:
    oid = r.get('other_id','')
    if oid:
        print(oid)
" 2>/dev/null)
        declare -A EXISTING_MAP
        while IFS= read -r oid; do
            [ -n "$oid" ] && EXISTING_MAP["$oid"]=1
        done <<< "$EXISTING_IDS"

        NEW_IDS=()
        for id in "${ALL_IDS[@]}"; do
            if [ -z "${EXISTING_MAP[$id]:-}" ]; then
                NEW_IDS+=("$id")
            fi
        done

        if [ ${#NEW_IDS[@]} -eq 0 ]; then
            info "所有课程均已缓存，无需重复操作"
            exit 0
        fi
        info "需缓存 ${#NEW_IDS[@]} 个新课程 (已过滤 ${#ALL_IDS[@]} - ${#NEW_IDS[@]} 个已存在)"

        step "逐个提交缓存 (间隔 3 秒)"
        SUCCESS=0
        FAIL=0
        for i in "${!NEW_IDS[@]}"; do
            ID="${NEW_IDS[$i]}"
            echo "  [$((i+1))/${#NEW_IDS[@]}] 缓存课程 ID: $ID"
            RESULT=$(curl -s --max-time 120 -X POST "$BASE_URL/v2/product/download" \
                -H "Authorization: Bearer $TOKEN" \
                -H "Content-Type: application/json" \
                -d "{\"pid\": $ID, \"download_video\": $DOWNLOAD_VIDEO, \"download_audio\": $DOWNLOAD_AUDIO}")
            STATUS=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',-1))" 2>/dev/null)
            if [ "$STATUS" = "0" ]; then
                echo "    ✓ 提交成功"
                SUCCESS=$((SUCCESS + 1))
            else
                MSG=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('msg','未知错误'))" 2>/dev/null)
                echo "    ✗ 提交失败: $MSG"
                FAIL=$((FAIL + 1))
            fi
            if [ $i -lt $((${#NEW_IDS[@]} - 1)) ]; then
                sleep 3
            fi
        done

        step "缓存完成"
        echo "  成功: $SUCCESS  失败: $FAIL"
        ;;
    *)
        echo "用法: $0 {all|db|server|build|migrate|cache-all|stop}"
        echo ""
        echo "  all        编译并启动全部服务 (默认)"
        echo "  db         仅启动 PostgreSQL"
        echo "  server     仅启动应用服务 (需先启动 db)"
        echo "  build      仅编译项目"
        echo "  migrate    执行 SQLite → PostgreSQL 数据迁移"
        echo "  cache-all  缓存全部体系课 (需传 Token 和 Cookie)"
        echo "  stop       停止全部服务"
        echo ""
        echo "示例:"
        echo "  $0 cache-all                                                           # 交互式输入 Token 和 Cookie"
        echo "  $0 cache-all 'token' 'cookie'                                          # 下载视频+音频 (默认)"
        echo "  $0 cache-all 'token' 'cookie' false true                               # 仅下载音频"
        echo "  $0 cache-all 'token' 'cookie' true false                               # 仅下载视频"
        echo "  $0 cache-all 'token' 'cookie' false false                              # 仅缓存元数据,不下载音视频"
        exit 1
        ;;
esac
