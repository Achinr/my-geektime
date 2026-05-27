#!/bin/bash
# 批量缓存体系课的脚本
# 用法: ./scripts/batch_download.sh <token> <cookie>

TOKEN="$1"
COOKIE="$2"
BASE="http://10.255.255.254:8090"

if [ -z "$TOKEN" ] || [ -z "$COOKIE" ]; then
  echo "用法: $0 <token> <cookie>"
  echo ""
  echo "获取 token:"
  echo "  打开浏览器 F12 → Application → Local Storage → token"
  echo "获取 cookie:"
  echo "  前端页面头像 → 刷新凭证 中填入的 cookie 值"
  exit 1
fi

# 1. 先刷新 Cookie
echo "=== 刷新 Cookie 凭证 ==="
curl -s -X POST "$BASE/v2/base/refresh/cookie" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"cookie\": \"$COOKIE\"}" | python3 -m json.tool 2>/dev/null || echo "Cookie saved"

# 2. 获取体系课列表 (product_type=1 体系课)
echo ""
echo "=== 获取体系课列表 ==="
RESPONSE=$(curl -s "$BASE/v2/product/pvip/list?page=1&perPage=1000&product_type=1&sort=8" \
  -H "Authorization: Bearer $TOKEN")

echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
rows = data.get('data', {}).get('rows', [])
if not rows:
    rows = data.get('rows', [])
print(f'共找到 {len(rows)} 个体系课')
for r in rows:
    print(f'  ID: {r[\"id\"]:>10}  {r[\"title\"][:40]}')
" 2>/dev/null

# 3. 获取已存在的任务列表
echo ""
echo "=== 查询已有任务 ==="
TASKS_RESP=$(curl -s "$BASE/v2/task/list?page=1&perPage=10000" \
  -H "Authorization: Bearer $TOKEN")

EXISTING_IDS=$(echo "$TASKS_RESP" | python3 -c "
import json, sys
data = json.load(sys.stdin)
rows = data.get('data', {}).get('rows', [])
if not rows:
    rows = data.get('rows', [])
ids = [r.get('other_id', '') for r in rows if r.get('other_id')]
print(','.join(ids))
" 2>/dev/null)

echo "已有任务 other_ids: $EXISTING_IDS"

# 4. 解析需要下载的课程
echo ""
echo "=== 开始批量提交下载 ==="
python3 -c "
import json, sys, time, urllib.request, urllib.error

token = '$TOKEN'
base = '$BASE'
existing = set('$EXISTING_IDS'.split(',')) if '$EXISTING_IDS' else set()

data = json.loads('$RESPONSE')
rows = data.get('data', {}).get('rows', [])
if not rows:
    rows = data.get('rows', [])

new_items = [r for r in rows if r.get('id') not in existing]
skipped = len(rows) - len(new_items)

print(f'筛选完成: 共 {len(rows)} 个, 已存在 {skipped} 个, 新增 {len(new_items)} 个')

for i, item in enumerate(new_items):
    pid = item['id']
    title = item.get('title', '')[:40]
    print(f'[{i+1}/{len(new_items)}] 提交下载: ID={pid} {title}')

    req = urllib.request.Request(
        f'{base}/v2/product/download',
        data=json.dumps({'pid': int(pid)}).encode(),
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
        method='POST'
    )
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read())
        if result.get('status') == 0:
            print(f'  -> 成功')
        else:
            print(f'  -> 失败: {result.get(\"msg\", \"unknown\")}')
    except Exception as e:
        print(f'  -> 错误: {e}')

    if i < len(new_items) - 1:
        time.sleep(3)  # SQLite 并发限制，间隔 3 秒

print()
print('=== 全部完成 ===')
" 2>&1
