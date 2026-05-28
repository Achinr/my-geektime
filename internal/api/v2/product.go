package v2

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/zkep/my-geektime/internal/global"
	"github.com/zkep/my-geektime/internal/model"
	"github.com/zkep/my-geektime/internal/service"
	"github.com/zkep/my-geektime/internal/types/geek"
	"github.com/zkep/my-geektime/internal/types/sys_dict"
	"github.com/zkep/my-geektime/internal/types/task"
	"github.com/zkep/my-geektime/libs/utils"
	"gorm.io/gorm"
)

type Product struct{}

func NewProduct() *Product {
	return &Product{}
}

func (p *Product) Download(c *gin.Context) {
	var req geek.DowloadRequest
	if err := c.BindJSON(&req); err != nil {
		global.FAIL(c, "fail.msg", err)
		return
	}
	accessToken := c.GetString(global.AccessToken)
	if accessToken == "" {
		global.FAIL(c, "product.no_cookie")
		return
	}
	articlesMap := make(map[int64]*model.Article, 10)
	ids := make([]int64, 0, 1)
	if req.Pid <= 0 {
		global.FAIL(c, "product.no_exists_pid")
		return
	}
	resp, err := service.GetArticles(c, accessToken,
		geek.ArticlesListRequest{
			Cid:   fmt.Sprintf("%d", req.Pid),
			Order: "earliest",
			Prev:  1,
			Size:  500,
		})
	if err != nil {
		global.FailWithError(c, err)
		return
	}
	if len(resp.Data.List) == 0 {
		global.FAIL(c, "product.api_busy")
		return
	}
	for _, v := range resp.Data.List {
		if v.ID <= 0 || v.ArticleTitle == "" {
			continue
		}
		ids = append(ids, v.ID)
		itemRaw, _ := json.Marshal(v)
		info := &model.Article{
			Aid:   fmt.Sprintf("%d", v.ID),
			Pid:   fmt.Sprintf("%d", req.Pid),
			Title: v.ArticleTitle,
			Cover: v.ArticleCover,
			Raw:   itemRaw,
		}
		if v.VideoCover != "" && info.Cover == "" {
			info.Cover = v.VideoCover
		}
		articlesMap[v.ID] = info
	}
	var product model.Product
	if err := global.DB.Model(&model.Product{}).
		Where(&model.Product{Pid: fmt.Sprintf("%d", req.Pid)}).Find(&product).Error; err != nil {
		global.FAIL(c, "fail.msg", err.Error())
		return
	}
	if product.Pid == "" {
		ret, err := service.GetColumnInfo(c, accessToken,
			geek.ColumnRequest{ProductID: req.Pid, WithRecommendArticle: true})
		if err != nil {
			global.FAIL(c, "fail.msg", err.Error())
			return
		}
		product.Title = ret.Data.Title
		product.Cover = ret.Data.Cover.Square
		product.Raw, _ = json.Marshal(ret.Data)
	}
	if len(articlesMap) == 0 {
		var articles []*model.Article
		if err := global.DB.Model(&model.Article{}).
			Where("aid IN ?", ids).Find(&articles).Error; err != nil {
			global.FAIL(c, "fail.msg", err.Error())
			return
		}
		for _, v := range articles {
			articlesMap[v.Id] = v
		}
	}
	jobId := utils.HalfUUID()
	job := &model.Task{
		TaskId:     jobId,
		TaskName:   product.Title,
		TaskType:   service.TASK_TYPE_PRODUCT,
		OtherId:    fmt.Sprintf("%d", req.Pid),
		Cover:      product.Cover,
		Raw:        product.Raw,
		OtherType:  product.OtherType,
		OtherForm:  product.OtherForm,
		OtherGroup: product.OtherGroup,
		OtherTag:   product.OtherTag,
	}
	tasks := make([]*model.Task, 0, len(ids))
	for _, id := range ids {
		var (
			raw      []byte
			otherId  string
			taskName string
			cover    string
		)
		if article, ok := articlesMap[id]; !ok {
			info, err := service.GetArticleInfo(c, accessToken, geek.ArticlesInfoRequest{Id: id})
			if err != nil {
				global.FAIL(c, "fail.msg", err.Error())
				return
			}
			var m geek.ArticleInfoRaw
			if err = json.Unmarshal(info.Raw, &m); err != nil {
				global.FAIL(c, "fail.msg", err.Error())
				return
			}
			raw = m.Data
			otherId = fmt.Sprintf("%d", info.Data.Info.ID)
			taskName = info.Data.Info.Title
			cover = info.Data.Info.Cover.Default
		} else {
			raw = article.Raw
			otherId = article.Aid
			taskName = article.Title
			cover = article.Cover
		}
		item := model.Task{
			TaskPid:    jobId,
			TaskId:     utils.HalfUUID(),
			OtherId:    otherId,
			TaskName:   taskName,
			TaskType:   service.TASK_TYPE_ARTICLE,
			Cover:      cover,
			Raw:        raw,
			OtherType:  product.OtherType,
			OtherForm:  product.OtherForm,
			OtherGroup: product.OtherGroup,
			OtherTag:   product.OtherTag,
		}
		// Set Bstatus based on per-request or global config
		if req.DownloadVideo != nil || req.DownloadAudio != nil {
			bstatus := 0
			if req.DownloadVideo != nil && *req.DownloadVideo {
				bstatus |= service.BSTATUS_DOWNLOAD_VIDEO
			}
			if req.DownloadAudio != nil && *req.DownloadAudio {
				bstatus |= service.BSTATUS_DOWNLOAD_AUDIO
			}
			if bstatus > 0 {
				bstatus |= service.BSTATUS_DOWNLOAD
				item.Bstatus = int32(bstatus)
			}
		} else if global.CONF.Site.Download {
			bstatus := service.BSTATUS_DOWNLOAD
			if global.CONF.Site.DownloadVideo {
				bstatus |= service.BSTATUS_DOWNLOAD_VIDEO
			}
			if global.CONF.Site.DownloadAudio {
				bstatus |= service.BSTATUS_DOWNLOAD_AUDIO
			}
			item.Bstatus = int32(bstatus)
		}
		tasks = append(tasks, &item)
	}
	count := len(tasks)
	statistics := task.TaskStatistics{
		Count: count,
		Items: map[int]int{
			service.TASK_STATUS_PENDING:  count,
			service.TASK_STATUS_RUNNING:  0,
			service.TASK_STATUS_FINISHED: 0,
			service.TASK_STATUS_ERROR:    0,
		},
	}
	job.Statistics, _ = json.Marshal(statistics)
	// Job Bstatus: set PENDING if any article will download media
	hasDownload := false
	for _, x := range tasks {
		if x.Bstatus > 0 {
			hasDownload = true
			break
		}
	}
	if hasDownload {
		job.Bstatus = service.TASK_STATUS_PENDING
	}
	err = global.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(job).Error; err != nil {
			return err
		}
		for _, x := range tasks {
			if err := tx.Create(x).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		global.FAIL(c, "fail.msg", err.Error())
		return
	}
	result := geek.DowloadResponse{JobID: jobId}
	global.OK(c, result)
}

func (p *Product) ProductList(c *gin.Context) {
	var req geek.DailyProductRequest
	if err := c.ShouldBind(&req); err != nil {
		global.FAIL(c, "fail.msg", err.Error())
		return
	}
	if req.Size <= 0 {
		req.Size = 20
	}
	if req.Prev <= 0 {
		req.Prev = 1
	}
	req.Prev = req.Prev - 1
	accessToken := global.CONF.Site.Cookie.Geektime
	resp, err := service.GetProduct(c, accessToken, req)
	if err != nil {
		global.FAIL(c, "fail.msg", err.Error())
		return
	}
	ret := geek.ProductListResponse{Rows: make([]geek.ProductListRow, 0)}
	ret.Score = resp.Data.Page.Score
	ret.Count = resp.Data.Page.Count
	if resp.Data.Page.Count == 0 {
		ret.HasNext = resp.Data.Page.More
	}
	for _, v := range resp.Data.List {
		row := geek.ProductListRow{
			ID:            v.ID,
			Title:         v.Title,
			Subtitle:      v.Subtitle,
			Intro:         v.Intro,
			IntroHTML:     v.IntroHTML,
			Ucode:         v.Ucode,
			IsFinish:      v.IsFinish,
			IsVideo:       v.IsVideo,
			IsAudio:       v.IsAudio,
			IsColumn:      v.IsColumn,
			IsCore:        v.IsCore,
			IsDailylesson: v.IsDailylesson,
			IsUniversity:  v.IsUniversity,
			IsOpencourse:  v.IsOpencourse,
			IsQconp:       v.IsQconp,
			IsMentor:      v.IsMentor,
			IsSale:        v.IsSale,
			Sale:          v.Price.Sale,
			SaleType:      v.Price.SaleType,
			Share:         v.Share,
			Author:        v.Author,
			Cover:         v.Cover,
			Article:       v.Article,
		}
		row.Cover.Square = service.URLProxyReplace(row.Cover.Square)
		row.Author.Avatar = service.URLProxyReplace(row.Author.Avatar)
		if len(row.IntroHTML) > 0 {
			if introHTML, err1 := service.HtmlURLProxyReplace(row.IntroHTML); err1 == nil {
				row.IntroHTML = introHTML
			}
		}
		row.Redirect = sys_dict.ProductURLWithType(v.Type, v.ID)
		ret.Rows = append(ret.Rows, row)
	}
	global.OK(c, ret)
}

// fillTaskDownloadStatus 查询任务表，填充课程的下载状态
func fillTaskDownloadStatus(rows []geek.ProductListRow) {
	if len(rows) == 0 {
		return
	}
	// 收集所有 product ID
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, strconv.Itoa(r.ID))
	}
	// 一次查询所有 product 任务的 other_id 与状态
	var tasks []struct {
		OtherId string `gorm:"column:other_id"`
		Status  int32  `gorm:"column:status"`
	}
	global.DB.Model(&model.Task{}).
		Select("other_id, status").
		Where("task_type = ?", service.TASK_TYPE_PRODUCT).
		Where("other_id IN ?", ids).
		Where("deleted_at = ?", 0).
		Find(&tasks)
	// 建立 other_id -> status 的映射
	statusMap := make(map[string]int32, len(tasks))
	for _, t := range tasks {
		statusMap[t.OtherId] = t.Status
	}
	// 填充每行的下载状态
	for i, r := range rows {
		pid := strconv.Itoa(r.ID)
		if st, ok := statusMap[pid]; ok {
			rows[i].TaskStatus = int(st)
			rows[i].Downloaded = st >= service.TASK_STATUS_FINISHED
		}
	}
}

func (p *Product) PvipProductList(c *gin.Context) {
	var req geek.PvipProductRequest
	if err := c.ShouldBind(&req); err != nil {
		global.FAIL(c, "fail.msg", err.Error())
		return
	}
	if req.Tag > 0 {
		req.TagIds = []int32{req.Tag}
	}
	req.Size = req.PerPage
	req.Prev = req.Page
	accessToken := global.CONF.Site.Cookie.Geektime
	ret := geek.ProductListResponse{Rows: make([]geek.ProductListRow, 0)}
	if len(req.Keyword) > 0 {
		searchReq := geek.SearchRequest{
			Keyword:  req.Keyword,
			Category: "product",
			Platform: "pc",
			Prev:     req.Prev,
			Size:     req.Size + 1,
		}
		searchRet, err := service.GeekTimeSearch(c, accessToken, searchReq)
		if err != nil {
			global.FAIL(c, "fail.msg", err.Error())
			return
		}
		ret.Count = searchRet.Data.Page.Count
		if len(searchRet.Data.List) > req.Size {
			ret.HasNext = true
			searchRet.Data.List = searchRet.Data.List[:req.Size]
		}
		for _, v := range searchRet.Data.List {
			if v.ItemType != "product" {
				continue
			}
			item := v.Product
			row := geek.ProductListRow{
				ID:       item.ID,
				Title:    item.Title,
				Subtitle: item.Subtitle,
				IsVideo:  item.Type == "c3",
				IsAudio:  item.Type == "c1",
			}
			row.Article.Count = item.TotalLesson
			row.Author.Name = item.AuthorName
			row.Author.Info = item.AuthorIntro
			row.Cover.Square = item.Cover
			row.Cover.Square = service.URLProxyReplace(row.Cover.Square)
			if len(row.IntroHTML) > 0 {
				if introHTML, err1 := service.HtmlURLProxyReplace(row.IntroHTML); err1 == nil {
					row.IntroHTML = introHTML
				}
			}
			ret.Rows = append(ret.Rows, row)
		}
		fillTaskDownloadStatus(ret.Rows)
		global.OK(c, ret)
		return
	}
	resp, err := service.GetPvipProduct(c, accessToken, req)
	if err != nil {
		global.FAIL(c, "fail.msg", err.Error())
		return
	}
	ret.Count = resp.Data.Page.Total
	if resp.Data.Page.Total == 0 {
		ret.HasNext = resp.Data.Page.More
	}
	for _, v := range resp.Data.Products {
		row := geek.ProductListRow{
			ID:            v.ID,
			Title:         v.Title,
			Subtitle:      v.Subtitle,
			Intro:         v.Intro,
			IntroHTML:     v.IntroHTML,
			Ucode:         v.Ucode,
			IsFinish:      v.IsFinish,
			IsVideo:       v.IsVideo,
			IsAudio:       v.IsAudio,
			IsColumn:      v.IsColumn,
			IsCore:        v.IsCore,
			IsDailylesson: v.IsDailylesson,
			IsUniversity:  v.IsUniversity,
			IsOpencourse:  v.IsOpencourse,
			IsQconp:       v.IsQconp,
			IsMentor:      v.IsMentor,
			IsSale:        v.IsSale,
			Sale:          v.Price.Sale,
			SaleType:      v.Price.SaleType,
			Share:         v.Share,
			Author:        v.Author,
			Cover:         v.Cover,
			Article:       v.Article,
		}
		row.Cover.Square = service.URLProxyReplace(row.Cover.Square)
		row.Author.Avatar = service.URLProxyReplace(row.Author.Avatar)
		if len(row.IntroHTML) > 0 {
			if introHTML, err1 := service.HtmlURLProxyReplace(row.IntroHTML); err1 == nil {
				row.IntroHTML = introHTML
			}
		}
		row.Redirect = sys_dict.ProductURLWithType(v.Type, v.ID)
		ret.Rows = append(ret.Rows, row)
	}
	fillTaskDownloadStatus(ret.Rows)
	global.OK(c, ret)
}
