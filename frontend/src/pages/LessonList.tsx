import React, { useEffect, useState, useRef, useCallback } from 'react'
import { getProductList, downloadProduct, ProductItem, getArticleInfo } from '@/api/product'
import { getTaskList } from '@/api/task'
import { getDictTree } from '@/api/dict'
import { Button, Card, Pagination, Select, Spinner, Drawer, Modal } from '@/components/ui'
import { useAuthStore } from '@/store/auth'
import { useToast } from '@/components/ui/Toast'
import { ExternalLink, Eye, Download, RefreshCw, CheckSquare, Square } from 'lucide-react'

const orderOptions = [
  { label: '最新', value: 'new' },
  { label: '最热', value: 'hot' },
]

const typeOptions = [{ label: '每日一课', value: 'd' }]

export const LessonList: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ProductItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(12)
  const [filters, setFilters] = useState({
    direction: 0,
    label_id: 0,
    orderby: 'new',
    type: 'd',
  })
  const [prevFilters, setPrevFilters] = useState<typeof filters | null>(null)

  // 使用 useRef 来跟踪是否已经加载过数据
  const hasLoadedRef = useRef(false)
  // 用于跟踪是否是用户主动改变页码
  const isUserPageChangeRef = useRef(false)
  // 用于保存上一页返回的 score，用于下一页请求
  const lastScoreRef = useRef<number>(0)
  const [geektimeCategory, setGeektimeCategory] = useState<any[]>([])
  const [geektimeDirection, setGeektimeDirection] = useState<any[]>([])
  const [showAllCategories, setShowAllCategories] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showCookieModal, setShowCookieModal] = useState(false)
  const [cookie, setCookie] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmItems, setConfirmItems] = useState<ProductItem[]>([])
  const [showDetailDrawer, setShowDetailDrawer] = useState(false)
  const [detailItem, setDetailItem] = useState<ProductItem | null>(null)
  const [articleDetail, setArticleDetail] = useState<any>(null)
  const [articleLoading, setArticleLoading] = useState(false)

  const geekAuth = useAuthStore((state) => state.geekAuth)
  const setGeekAuth = useAuthStore((state) => state.setGeekAuth)
  const { addToast } = useToast()

  useEffect(() => {
    loadDictData()
  }, [])

  useEffect(() => {
    // 只有当 filters 真正发生变化时才重新加载数据
    if (prevFilters && JSON.stringify(prevFilters) === JSON.stringify(filters)) {
      return
    }
    
    // 初始化时不立即加载，避免与下面的 useEffect 冲突
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      // 初始化时直接加载数据
      loadData()
      setPrevFilters(filters)
      return
    }
    
    // 非初始化时，重置页码、score 并直接加载第一页数据
    setPrevFilters(filters)
    setPage(1)
    lastScoreRef.current = 0
    loadData(1)
  }, [filters.direction, filters.label_id, filters.orderby, filters.type])

  useEffect(() => {
    // 初始化时由第一个 useEffect 处理，这里只处理用户主动改变页码
    if (!hasLoadedRef.current) {
      return
    }
    
    // 如果是用户主动改变页码（通过分页组件），则加载数据
    if (isUserPageChangeRef.current || page > 1) {
      isUserPageChangeRef.current = false
      loadData()
    }
  }, [page, perPage])

  const loadDictData = async () => {
    try {
      const res = await getDictTree('geektimeCategory')
      if (res) {
        const categories = res.geektimeCategory || []
        const directions = categories
          .filter((item: any) => item.label !== '全部')
          .map((item: any) => ({
            label: item.label,
            value: Number(item.value),
            children: item.children
              ?.filter((c: any) => c.label !== '全部')
              .map((c: any) => ({
                label: c.label,
                value: Number(c.value),
              })) || [],
          }))
        setGeektimeCategory(directions)
        setGeektimeDirection(directions)
      }
    } catch (error) {
      console.error('Failed to load dict data', error)
    }
  }

  const loadData = async (loadPage?: number) => {
    setLoading(true)
    try {
      const currentPage = loadPage || page
      // 第一页时 prev 为页码，第二页开始 prev 为上一页返回的 score
      const prevValue = currentPage === 1 ? 1 : (lastScoreRef.current || 1)
      const params: any = { prev: prevValue, size: perPage, orderby: filters.orderby, type: filters.type }
      if (filters.direction) params.direction = filters.direction
      if (filters.label_id) params.label_id = filters.label_id

      const res = await getProductList(params)
      setItems(res.rows || [])
      setTotalCount(res.count || 0)
      // 保存返回的 score，用于下一页请求
      if (res.score) {
        lastScoreRef.current = res.score
      }
    } catch (error) {
      console.error('Failed to load products', error)
    } finally {
      setLoading(false)
    }
  }

  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id))
  const selectedItems = items.filter((item) => selectedIds.has(item.id))

  const handleDownloadClick = (item: ProductItem) => {
    setConfirmItems([item])
    setShowConfirmModal(true)
  }

  const handleBatchDownloadClick = async () => {
    if (selectedItems.length === 0) {
      addToast('请先选择课程', 'warning')
      return
    }
    try {
      const res = await getTaskList({ perPage: 10000 })
      const existingIds = new Set((res.rows || []).map((t) => t.other_id?.toString()))
      const newItems = selectedItems.filter((item) => !existingIds.has(item.id))
      if (newItems.length === 0) {
        addToast('选中的课程都已存在，无需重复缓存', 'info')
        return
      }
      const skipped = selectedItems.length - newItems.length
      if (skipped > 0) {
        addToast(`${skipped} 个课程已存在，已自动过滤`, 'info')
      }
      setConfirmItems(newItems)
      setShowConfirmModal(true)
    } catch (error) {
      console.error('Failed to check existing tasks', error)
      setConfirmItems(selectedItems)
      setShowConfirmModal(true)
    }
  }

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)))
    }
  }, [allSelected, items])

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleDownloadConfirm = () => {
    const items = confirmItems
    if (items.length === 0) return
    setShowConfirmModal(false)
    setConfirmItems([])
    setSelectedIds(new Set())
    addToast(`开始缓存 ${items.length} 个课程...`, 'info')
    // 后台逐个执行，不阻塞 UI
    ;(async () => {
      let successCount = 0
      let failCount = 0
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
        try {
          await downloadProduct({ pid: Number(item.id) })
          successCount++
        } catch (error) {
          console.error(`Failed to download ${item.title}`, error)
          failCount++
        }
      }
      if (failCount > 0) {
        addToast(`缓存完成：${successCount} 成功，${failCount} 失败`, 'warning')
      } else {
        addToast(`缓存完成：${successCount} 个`, 'success')
      }
    })()
  }

  const handleViewDetail = async (item: ProductItem) => {
    setDetailItem(item)
    setShowDetailDrawer(true)
    setArticleLoading(true)
    try {
      const res = await getArticleInfo(item.article?.id || '')
      setArticleDetail(res)
    } catch (error) {
      console.error('Failed to load article detail', error)
    } finally {
      setArticleLoading(false)
    }
  }

  const handleSaveCookie = async () => {
    if (!cookie || cookie.length < 50) {
      addToast('Cookie 不少于50个字符', 'warning')
      return
    }
    try {
      const response = await fetch('/v2/base/refresh/cookie', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ cookie }),
      })
      const data = await response.json()
      if (data.status === 0) {
        setGeekAuth(true)
        setShowCookieModal(false)
        setCookie('')
        addToast('Cookie 保存成功', 'success')
      } else {
        addToast(data.msg || 'Cookie 保存失败', 'error')
      }
    } catch (error) {
      console.error('Failed to save cookie', error)
      addToast('Cookie 保存失败，请重试', 'error')
    }
  }

  return (
    <div>
      <Card header="每日一课" />

      <Card className="mt-4">
        <div className="bg-gradient-to-r from-primary-50/50 to-primary-100/50 rounded-xl p-4 mb-4 border border-primary-100/50">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">课程方向</label>
              <div className="flex flex-wrap gap-2">
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    filters.direction === 0
                      ? 'bg-primary-500/10 text-primary-600 border border-primary-300 shadow-sm'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:bg-primary-50'
                  }`}
                  onClick={() => setFilters({ ...filters, direction: 0, label_id: 0 })}
                >
                  全部
                </button>
                {geektimeDirection.map((item) => (
                  <button
                    key={item.value}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                      filters.direction === item.value
                        ? 'bg-primary-500/10 text-primary-600 border border-primary-300 shadow-sm'
                        : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:bg-primary-50'
                    }`}
                    onClick={() => setFilters({ ...filters, direction: item.value, label_id: 0 })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">课程分类</label>
              <div className="flex flex-wrap gap-2 items-center">
                {(() => {
                  const categoryOptions = filters.direction
                    ? geektimeCategory.find((c) => c.value === filters.direction)?.children || []
                    : geektimeCategory.flatMap((c) => c.children || [])
                  const allOptions = [{ label: '全部', value: 0 }, ...categoryOptions]
                  const displayCount = 12
                  const shouldShowMore = allOptions.length > displayCount
                  const visibleOptions = showAllCategories ? allOptions : allOptions.slice(0, displayCount)

                  return (
                    <>
                      {visibleOptions.map((item: any) => (
                        <button
                          key={item.value}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                            filters.label_id === item.value
                              ? 'bg-primary-500/10 text-primary-600 border border-primary-300 shadow-sm'
                              : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:bg-primary-50'
                          }`}
                          onClick={() => setFilters({ ...filters, label_id: item.value })}
                        >
                          {item.label}
                        </button>
                      ))}
                      {shouldShowMore && (
                        <button
                          className="px-3 py-1.5 rounded-lg text-sm font-medium text-primary-600 bg-primary-50 border border-primary-200 hover:bg-primary-100 transition-all duration-200"
                          onClick={() => setShowAllCategories(!showAllCategories)}
                        >
                          {showAllCategories ? '收起' : `更多 (${allOptions.length - displayCount})`}
                        </button>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                label="排序"
                options={orderOptions}
                value={filters.orderby}
                onChange={(e) =>
                  setFilters({ ...filters, orderby: e.target.value })
                }
              />
              <Select
                label="课程类型"
                options={typeOptions}
                value={filters.type}
                onChange={(e) =>
                  setFilters({ ...filters, type: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3 px-1">
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary-600 transition-colors"
              >
                {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                {allSelected ? '取消全选' : '全选'}
              </button>
              <div className="flex items-center gap-2">
                {selectedItems.length > 0 && (
                  <span className="text-sm text-gray-500">已选 {selectedItems.length} 项</span>
                )}
                {geekAuth ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={selectedItems.length === 0}
                    onClick={handleBatchDownloadClick}
                  >
                    <Download size={14} className="mr-1" />
                    批量缓存
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`border rounded-lg p-4 transition-colors ${
                    selectedIds.has(item.id)
                      ? 'border-primary-400 bg-primary-50/50'
                      : 'hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => handleToggleSelect(item.id)}
                      className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-primary-500 transition-colors"
                    >
                      {selectedIds.has(item.id) ? <CheckSquare size={18} className="text-primary-500" /> : <Square size={18} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-800 truncate">
                        {item.title}
                      </h3>
                      <p className="text-sm text-gray-500 truncate">
                        {item.author?.intro}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">作者: </span>
                      {item.author?.name}
                    </div>
                    <div>
                      <span className="text-gray-500">ID: </span>
                      {item.article?.id}
                    </div>
                    <div>
                      <span className="text-gray-500">价格: </span>
                      {item.sale_type === 6 || item.sale_type === 7
                        ? '免费'
                        : `¥${(item.sale / 100).toFixed(2)}`}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {item.redirect && (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={() => window.open(item.redirect, '_blank')}
                      >
                        <ExternalLink size={14} className="mr-1" />
                        源站
                      </Button>
                    )}
                    <Button variant="light" size="sm" onClick={() => handleViewDetail(item)}>
                      <Eye size={14} className="mr-1" />
                      详情
                    </Button>
                    {geekAuth ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleDownloadClick(item)}
                      >
                        <Download size={14} className="mr-1" />
                        缓存
                      </Button>
                    ) : (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={() => setShowCookieModal(true)}
                      >
                        <RefreshCw size={14} className="mr-1" />
                        缓存
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {items.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <div className="text-lg">暂无数据</div>
              </div>
            )}
            <Pagination
              current={page}
              total={totalCount}
              pageSize={perPage}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      <Drawer
        isOpen={showCookieModal}
        onClose={() => setShowCookieModal(false)}
        title="Cookie登录"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            请先保存【极客时间VIP登录凭据】，该登录凭据是全站共享的基础，下载期间避免失效，失效后下载会找不到下载链接
          </p>
          <a
            href="https://zkep.github.io/my-geektime/guide/data_geektime/"
            target="_blank"
            className="text-blue-600 text-sm hover:underline"
          >
            查看详细文档
          </a>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cookie
            </label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="请输入极客时间Cookie"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={5}
            />
          </div>
          <Button onClick={handleSaveCookie} className="w-full">
            保存Cookie
          </Button>
        </div>
      </Drawer>

      <Modal
        isOpen={showConfirmModal}
        onClose={() => {
          setShowConfirmModal(false)
          setConfirmItems([])
        }}
        title="确认缓存"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {confirmItems.length === 1
              ? `缓存 [${confirmItems[0]?.title}] 后请在 [我的课程] 查看详情`
              : `缓存选中的 ${confirmItems.length} 个课程后请在 [我的课程] 查看详情`}
          </p>
          {confirmItems.length > 1 && (
            <div className="max-h-32 overflow-y-auto border rounded-lg p-2">
              {confirmItems.map((item) => (
                <div key={item.id} className="text-sm text-gray-600 py-1 truncate">
                  {item.title}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setShowConfirmModal(false)
                setConfirmItems([])
              }}
              className="flex-1"
            >
              取消
            </Button>
            <Button
              onClick={handleDownloadConfirm}
              className="flex-1"
            >
              确定{confirmItems.length > 1 ? ` (${confirmItems.length})` : ''}
            </Button>
          </div>
        </div>
      </Modal>

      <Drawer
        isOpen={showDetailDrawer}
        onClose={() => {
          setShowDetailDrawer(false)
          setDetailItem(null)
          setArticleDetail(null)
        }}
        title="课程详情"
        size="xl"
      >
        {detailItem && (
          <div className="space-y-6">
            {/* Article Info Header */}
            <div className="bg-gradient-to-r from-primary-50 to-primary-100 rounded-lg p-4">
              <h3 className="text-xl font-bold text-gray-800 mb-3">{detailItem.title}</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">作者: </span>
                  <span className="font-medium">{detailItem.author?.name}</span>
                </div>
                <div>
                  <span className="text-gray-500">文章ID: </span>
                  <span className="font-medium">{detailItem.article?.id}</span>
                </div>
                <div>
                  <span className="text-gray-500">价格: </span>
                  <span className="font-medium">
                    {detailItem.sale_type === 6 || detailItem.sale_type === 7
                      ? '免费'
                      : `¥${(detailItem.sale / 100).toFixed(2)}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Article Detail Content */}
            {articleLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : articleDetail ? (
              <>
                {/* Video/Audio Player */}
                {articleDetail.video?.hls_medias && articleDetail.video.hls_medias.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-semibold text-gray-700 mb-3 flex items-center">
                      <span className="w-1 h-5 bg-primary-400 rounded mr-2"></span>
                      视频播放
                    </h4>
                    <video
                      controls
                      className="w-full rounded-lg shadow-md"
                      poster={articleDetail.cover?.default}
                      src={articleDetail.video.hls_medias[articleDetail.video.hls_medias.length - 1].url}
                    >
                      您的浏览器不支持视频播放
                    </video>
                    <div className="mt-2 text-sm text-gray-500">
                      视频大小: {(articleDetail.video_size / 1048576).toFixed(2)} M
                    </div>
                  </div>
                )}

                {articleDetail.video_preview?.medias && !articleDetail.video?.hls_medias && (
                  <div className="mb-4">
                    <h4 className="font-semibold text-gray-700 mb-3 flex items-center">
                      <span className="w-1 h-5 bg-primary-400 rounded mr-2"></span>
                      预览视频
                    </h4>
                    <video
                      controls
                      className="w-full rounded-lg shadow-md"
                      poster={articleDetail.cover?.default}
                      src={articleDetail.video_preview.medias[articleDetail.video_preview.medias.length - 1].url}
                    >
                      您的浏览器不支持视频播放
                    </video>
                  </div>
                )}

                {articleDetail.audio?.url && !articleDetail.video?.hls_medias && !articleDetail.video_preview?.medias && (
                  <div className="mb-4">
                    <h4 className="font-semibold text-gray-700 mb-3 flex items-center">
                      <span className="w-1 h-5 bg-primary-400 rounded mr-2"></span>
                      音频播放
                    </h4>
                    <audio
                      controls
                      className="w-full"
                      src={articleDetail.audio.url}
                    >
                      您的浏览器不支持音频播放
                    </audio>
                    <div className="mt-2 text-sm text-gray-500">
                      音频大小: {(articleDetail.audio_size / 1048576).toFixed(2)} M
                    </div>
                  </div>
                )}

                {/* Article Content */}
                {articleDetail.content && (
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-3 flex items-center">
                      <span className="w-1 h-5 bg-primary-400 rounded mr-2"></span>
                      文章内容
                    </h4>
                    <div 
                      className="text-sm text-gray-700 leading-relaxed space-y-3 border rounded-lg p-4 bg-gray-50"
                      dangerouslySetInnerHTML={{ __html: articleDetail.content }}
                    />
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t">
                  {articleDetail.redirect && (
                    <Button
                      variant="secondary"
                      onClick={() => window.open(articleDetail.redirect, '_blank')}
                    >
                      <ExternalLink size={16} className="mr-2" />
                      查看源站
                    </Button>
                  )}
                  {detailItem.article?.id && (
                    geekAuth ? (
                      <Button
                        variant="primary"
                        onClick={() => {
                          setShowDetailDrawer(false)
                          handleDownloadClick(detailItem)
                        }}
                      >
                        <Download size={16} className="mr-2" />
                        缓存课程
                      </Button>
                    ) : (
                      <Button
                        variant="light"
                        onClick={() => {
                          setShowDetailDrawer(false)
                          setShowCookieModal(true)
                        }}
                      >
                        <RefreshCw size={16} className="mr-2" />
                        设置Cookie后缓存
                      </Button>
                    )
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-500">
                加载失败
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
