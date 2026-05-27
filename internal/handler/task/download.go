package task

import (
	"bytes"
	"context"
	"encoding/json"
	"path"
	"strconv"
	"sync"
	"time"

	"github.com/zkep/my-geektime/internal/global"
	"github.com/zkep/my-geektime/internal/model"
	"github.com/zkep/my-geektime/internal/service"
	"github.com/zkep/my-geektime/internal/types/geek"
	"github.com/zkep/my-geektime/internal/types/task"
	"go.uber.org/zap"
)

var (
	keyLock = "_key_lock_"
	lock    = &sync.Map{}
)

func TaskHandler(ctx context.Context, t time.Time) error {
	_, loaded := lock.LoadOrStore(keyLock, t)
	if loaded {
		if err := iterators(ctx, true); err != nil {
			global.LOG.Error("task handler iterators", zap.Error(err), zap.Bool("loaded", loaded))
		}
		return nil
	}
	defer lock.Delete(keyLock)
	if err := iterators(ctx, false); err != nil {
		global.LOG.Error("task handler iterators", zap.Error(err), zap.Bool("loaded", loaded))
	}
	return nil
}

func iterators(ctx context.Context, loaded bool) error {
	timeCtx, timeCancel := context.WithTimeout(ctx, time.Hour)
	defer timeCancel()
	// 统一处理所有 PENDING 任务，按 task_pid 分组
	// 避免将 product 任务和 article 任务分开处理：
	// product 任务在统计子任务状态时可能将自身设回 PENDING，
	// 导致 product 循环无法退出，article 任务得不到处理
	if loaded {
		return processTasksBatch(timeCtx, true)
	}
	return processTasksBatch(timeCtx, false)
}

// processTasksBatch 按 task_pid 分组批量处理 PENDING 任务
func processTasksBatch(ctx context.Context, loaded bool) error {
	psize := 6
	for {
		var ls []*model.Task
		tx := global.DB.Model(&model.Task{})
		if loaded {
			tx = tx.Where("status <= ?", service.TASK_STATUS_PENDING)
		} else {
			tx = tx.Where("status = ?", service.TASK_STATUS_PENDING)
		}
		tx = tx.Where("deleted_at = ?", 0)
		if err := tx.Order("id ASC").
			Limit(psize + 1).
			Find(&ls).Error; err != nil {
			global.LOG.Error("task handler find", zap.Error(err))
			return err
		}
		if len(ls) == 0 {
			return nil
		}
		hasMore := len(ls) > psize
		if hasMore {
			ls = ls[:psize]
		}
		// 按 task_pid 分组：从当前批次中找出所有不同的 task_pid
		// 对于每个 task_pid，连同已属于同组的其他任务一起处理
		if err := processGrouped(ctx, ls); err != nil {
			return err
		}
		if !hasMore {
			return nil
		}
	}
}

// processGrouped 按 task_pid 分组处理任务
// 对于批次中的每个 task_id/task_pid，查询所有同组的 PENDING 子任务一起处理
func processGrouped(ctx context.Context, tasks []*model.Task) error {
	type groupKey struct {
		pid  string
		isProduct bool
	}
	seen := make(map[groupKey]bool)
	for _, t := range tasks {
		var gk groupKey
		if t.TaskPid == "" {
			// product 类型：按 task_id 分组
			gk = groupKey{pid: t.TaskId, isProduct: true}
		} else {
			// article 类型：按 task_pid 分组
			gk = groupKey{pid: t.TaskPid, isProduct: false}
		}
		if seen[gk] {
			continue
		}
		seen[gk] = true
	}
	for gk := range seen {
		var group []*model.Task
		tx := global.DB.Model(&model.Task{}).
			Where("deleted_at = ?", 0).
			Where("status = ?", service.TASK_STATUS_PENDING)
		if gk.isProduct {
			tx = tx.Where("task_id = ?", gk.pid)
		} else {
			tx = tx.Where("task_pid = ?", gk.pid)
		}
		if err := tx.Order("id ASC").Find(&group).Error; err != nil {
			global.LOG.Error("task handler find group", zap.Error(err), zap.String("pid", gk.pid))
			return err
		}
		if len(group) == 0 {
			continue
		}
		if err := processTasks(ctx, group); err != nil {
			return err
		}
	}
	return nil
}

// processTasks 批量处理一组任务
func processTasks(ctx context.Context, tasks []*model.Task) error {
	orderTasks, batchTasks := make([]*model.Task, 0, len(tasks)), make([]*model.Task, 0, len(tasks))
	for _, value := range tasks {
		if len(value.RewriteHls) == 0 {
			orderTasks = append(orderTasks, value)
		} else {
			batchTasks = append(batchTasks, value)
		}
	}
	batch := global.GPool.NewBatch()
	for _, value := range batchTasks {
		x := value
		batch.Queue(func(pctx context.Context) (any, error) {
			err := worker(pctx, x)
			if err != nil {
				global.LOG.Error("task handler worker", zap.Error(err), zap.String("taskid", x.TaskId))
			}
			return nil, err
		})
	}
	for _, value := range orderTasks {
		x := value
		batch.Queue(func(pctx context.Context) (any, error) {
			err := worker(pctx, x)
			if err != nil {
				global.LOG.Error("task handler worker", zap.Error(err), zap.String("taskid", x.TaskId))
			}
			return nil, err
		})
	}
	if _, err := batch.Wait(ctx); err != nil {
		global.LOG.Error("task handler wait", zap.Error(err))
		return err
	}
	return nil
}

func worker(ctx context.Context, x *model.Task) error {
	switch x.TaskType {
	case service.TASK_TYPE_PRODUCT:
		return doProduct(ctx, x)
	case service.TASK_TYPE_ARTICLE:
		return doArticle(ctx, x)
	default:
	}
	return nil
}

func doProduct(_ context.Context, x *model.Task) error {
	var statistics task.TaskStatistics
	if err := json.Unmarshal(x.Statistics, &statistics); err != nil {
		global.LOG.Error("worker Unmarshal", zap.Error(err), zap.String("taskId", x.TaskId))
	}
	if statistics.Items == nil {
		statistics.Items = make(map[int]int, 5)
	}
	pendingCount, runingCount, errorCount := int64(0), int64(0), int64(0)
	for _, item := range service.ALLStatus {
		var itemCount int64
		if err := global.DB.Model(&model.Task{}).
			Where("task_pid = ?", x.TaskId).
			Where("status = ?", item).
			Count(&itemCount).Error; err != nil {
			global.LOG.Error("worker count", zap.Error(err), zap.String("taskId", x.TaskId))
		}
		switch item {
		case service.TASK_STATUS_PENDING:
			pendingCount = itemCount
		case service.TASK_STATUS_RUNNING:
			runingCount = itemCount
		case service.TASK_STATUS_ERROR:
			errorCount = itemCount
		}
		statistics.Items[item] = int(itemCount)
	}
	status := service.TASK_STATUS_FINISHED
	if pendingCount > 0 {
		status = service.TASK_STATUS_PENDING
	}
	if runingCount > 0 {
		status = service.TASK_STATUS_PENDING
	}
	if errorCount > 0 {
		status = service.TASK_STATUS_ERROR
	}
	raw, _ := json.Marshal(statistics)
	m := model.Task{
		Id:         x.Id,
		Status:     int32(status),
		Statistics: raw,
		UpdatedAt:  time.Now().Unix(),
	}
	var product geek.ProductBase
	if len(x.Raw) > 0 {
		_ = json.Unmarshal(x.Raw, &product)
	}
	if x.Bstatus > 0 {
		if status == service.TASK_STATUS_FINISHED {
			dir := path.Join(x.TaskId, service.VerifyFileName(product.Title))
			dirURL := global.Storage.GetKey(dir, false)
			message := task.TaskMessage{Object: dirURL}
			m.Message, _ = json.Marshal(message)
		}
	}
	if err := global.DB.Model(&model.Task{}).Where(&model.Task{Id: x.Id}).Updates(&m).Error; err != nil {
		global.LOG.Error("worker Updates", zap.Error(err), zap.String("taskId", x.TaskId))
		return err
	}
	if global.CONF.Site.Cache {
		global.Resource.Push(
			product.Author.Avatar,
			product.Cover.Square,
			product.Share.Cover,
			product.Share.Poster,
			product.Column.CatalogPicURL,
		)
	}
	return nil
}

func doArticle(ctx context.Context, x *model.Task) error {
	m := model.Task{
		Id:        x.Id,
		Status:    service.TASK_STATUS_RUNNING,
		UpdatedAt: time.Now().Unix(),
	}
	var data geek.ArticleData
	if len(x.RewriteHls) > 0 {
		if len(x.Ciphertext) == 0 && bytes.Contains(x.RewriteHls, []byte("{host}/v2/task/kms")) {
			x.RewriteHls = []byte(``)
		}
		if !bytes.Contains(x.RewriteHls, []byte("#EXTM3U")) {
			x.RewriteHls = []byte(``)
		}
	}
	if len(x.RewriteHls) == 0 {
		aid, err := strconv.ParseInt(x.OtherId, 10, 64)
		if err != nil {
			global.LOG.Error("worker ParseInt", zap.Error(err), zap.String("taskId", x.TaskId))
			return err
		}
		// 从配置文件中获取极客时间 Cookie
		accessToken := global.CONF.Site.Cookie.Geektime
		if accessToken != "" {
			var auth geek.AuthResponse
			if err = service.Authority(accessToken, service.SaveCookie(accessToken, "", &auth)); err != nil {
				global.LOG.Error("worker Authority", zap.Error(err), zap.String("taskId", x.TaskId))
				return err
			}
			article, err1 := service.GetArticleInfo(ctx, accessToken, geek.ArticlesInfoRequest{Id: aid})
			if err1 != nil {
				global.LOG.Error("worker GetArticleInfo", zap.Error(err1), zap.String("taskId", x.TaskId))
				return err1
			}
			if article.Data.Info.ID <= 0 {
				global.LOG.Error("worker GetArticleInfo empty",
					zap.String("taskId", x.TaskId), zap.Int64("articleID", aid))
			}
			if err = service.ArticleAllComment(ctx, "", accessToken, aid); err != nil {
				global.LOG.Error("worker ArticleAllComment", zap.Error(err), zap.String("taskId", x.TaskId))
			}
			data = article.Data
			var info geek.ArticleInfoRaw
			if err = json.Unmarshal(article.Raw, &info); err != nil {
				global.LOG.Error("worker Unmarshal", zap.Error(err), zap.String("taskId", x.TaskId))
				return err
			}
			m.Raw = info.Data
			x.Raw = info.Data
		}
	} else {
		if err := json.Unmarshal(x.Raw, &data); err != nil {
			global.LOG.Error("worker Unmarshal", zap.Error(err), zap.String("taskId", x.TaskId))
			return err
		}
	}
	if err := global.DB.Where(&model.Task{Id: x.Id}).Updates(m).Error; err != nil {
		global.LOG.Error("worker Updates", zap.Error(err), zap.String("taskId", x.TaskId))
		return err
	}
	status := service.TASK_STATUS_FINISHED
	if err := service.Download(ctx, x, data); err != nil {
		global.LOG.Error("worker download", zap.Error(err), zap.String("taskId", x.TaskId))
		status = service.TASK_STATUS_ERROR
		message := task.TaskMessage{Text: err.Error()}
		x.Message, _ = json.Marshal(message)
	}
	m.Ciphertext = x.Ciphertext
	m.RewriteHls = x.RewriteHls
	m.Message = x.Message
	m.Status = int32(status)
	m.UpdatedAt = time.Now().Unix()
	if err := global.DB.Where(&model.Task{Id: x.Id}).Updates(&m).Error; err != nil {
		global.LOG.Error("worker Updates", zap.Error(err), zap.String("taskId", x.TaskId))
		return err
	}
	if global.CONF.Site.Cache {
		global.Resource.Push(
			data.Info.Author.Avatar,
			data.Info.Video.Cover,
			data.Info.Cover.Default,
			data.Info.Cover.Square,
		)
		urls, err := service.FindURLWithHTML(data.Info.Content)
		if err != nil {
			global.LOG.Error("worker FindURLWithHTML", zap.Error(err), zap.String("taskId", x.TaskId))
		} else {
			global.Resource.Push(urls...)
		}
	}
	return nil
}
