import React, { useEffect, useState, useRef, useCallback } from 'react'
import { getPvipList, downloadProduct, ProductItem } from '@/api/product'
import { getTaskList } from '@/api/task'
import { getDictTree } from '@/api/dict'
import { Button, Card, Pagination, Select, Input, Spinner, Drawer, Modal } from '@/components/ui'
import { ArticleList } from '@/components/ArticleList'
import { useAuthStore } from '@/store/auth'
import { useToast } from '@/components/ui/Toast'
import { ExternalLink, Eye, Download, RefreshCw, CheckSquare, Square } from 'lucide-react'
import { useDebounce } from '@/hooks/useDebounce'

const productTypeOptions = [
  { label: '全部类型', value: 0 },
  { label: '体系课', value: 1 },
  { label: '公开课', value: 4 },
  { label: '线下大会', value: 5 },
  { label: '社区课', value: 6 },
]

const productFormOptions = [
  { label: '全部形式', value: 0 },
  { label: '图文+音频', value: 1 },
  { label: '视频', value: 2 },
]

const productSortOptions = [
  { label: '综合', value: 8 },
  { label: '最新', value: 1 },
  { label: '最热', value: 4 },
]

const cacheFilterOptions = [
  { label: '全部', value: 0 },
  { label: '已缓存', value: 1 },
  { label: '未缓存', value: 2 },
]

export const PvipList: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(12)
  const [filters, setFilters] = useState({
    direction: 0,
    tag: 0,
    product_type: 0,
    product_form: 0,
    sort: 8,
    keyword: '',
    cache_filter: 0,
  })
  const [prevFilters, setPrevFilters] = useState<typeof filters | null>(null)

  // 使用 useRef 来跟踪是否已经加载过数据
  const hasLoadedRef = useRef(false)
  // 用于跟踪是否是用户主动改变页码
  const isUserPageChangeRef = useRef(false)

  // 为关键字搜索添加防抖
  const debouncedKeyword = useDebounce(filters.keyword, 500)
  const [geektimeCategory, setGeektimeCategory] = useState<any[]>([])
  const [geektimeDirection, setGeektimeDirection] = useState<any[]>([])
  const [showAllCategories, setShowAllCategories] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showCookieModal, setShowCookieModal] = useState(false)
  const [cookie, setCookie] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmItems, setConfirmItems] = useState<ProductItem[]>([])
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailItem, setDetailItem] = useState<ProductItem | null>(null)

  const geekAuth = useAuthStore((state) => state.geekAuth)
  const setGeekAuth = useAuthStore((state) => state.setGeekAuth)
  const { addToast } = useToast()

  useEffect(() => {
    loadDictData()
  }, [])

  useEffect(() => {
    // 只有当 filters 真正发生变化时才重新加载数据
    if (prevFilters && JSON.stringify(prevFilters) === JSON.stringify({ ...filters, keyword: prevFilters.keyword })) {
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
    
    // 非初始化时，重置页码并直接加载第一页数据
    setPrevFilters(filters)
    setPage(1)
    loadData(1)
  }, [debouncedKeyword, filters.direction, filters.tag, filters.product_type, filters.product_form, filters.sort, filters.cache_filter])

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
      const params: any = {
        page: currentPage,
        perPage,
        sort: filters.sort,
        with_articles: true,
      }
      if (filters.direction) params.direction = filters.direction
      if (filters.tag) params.tag = filters.tag
      if (filters.product_type) params.product_type = filters.product_type
      if (filters.product_form) params.product_form = filters.product_form
      if (debouncedKeyword) params.keyword = debouncedKeyword

      const res = await getPvipList(params)
      setItems(res.rows || [])
      setTotal(res.count || 0)
    } catch (error) {
      console.error('Failed to load products', error)
    } finally {
      setLoading(false)
    }
  }

  // 客户端缓存状态筛选
  const filteredItems = React.useMemo(() => {
    if (filters.cache_filter === 0) return items
    if (filters.cache_filter === 1) return items.filter((item) => item.downloaded)
    if (filters.cache_filter === 2) return items.filter((item) => !item.downloaded)
    return items
  }, [items, filters.cache_filter])

  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id))
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
      setSelectedIds(new Set(filteredItems.map((item) => item.id)))
    }
  }, [allSelected, filteredItems])

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

  const handleViewDetail = (item: ProductItem) => {
    setDetailItem(item)
    setShowDetailModal(true)
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
      <Card header="体系/公开/线下大会" />

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
                  onClick={() => setFilters({ ...filters, direction: 0, tag: 0 })}
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
                    onClick={() => setFilters({ ...filters, direction: item.value, tag: 0 })}
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
                            filters.tag === item.value
                              ? 'bg-primary-500/10 text-primary-600 border border-primary-300 shadow-sm'
                              : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:bg-primary-50'
                          }`}
                          onClick={() => setFilters({ ...filters, tag: item.value })}
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <Select
                label="排序"
                options={productSortOptions}
                value={filters.sort}
                onChange={(e) =>
                  setFilters({ ...filters, sort: Number(e.target.value) })
                }
              />
              <Select
                label="课程类型"
                options={productTypeOptions}
                value={filters.product_type}
                onChange={(e) =>
                  setFilters({ ...filters, product_type: Number(e.target.value) })
                }
              />
              <Select
                label="课程形式"
                options={productFormOptions}
                value={filters.product_form}
                onChange={(e) =>
                  setFilters({ ...filters, product_form: Number(e.target.value) })
                }
              />
              <Select
                label="缓存状态"
                options={cacheFilterOptions}
                value={filters.cache_filter}
                onChange={(e) =>
                  setFilters({ ...filters, cache_filter: Number(e.target.value) })
                }
              />
              <Input
                label="搜索关键字"
                placeholder="搜索关键字"
                value={filters.keyword}
                onChange={(e) =>
                  setFilters({ ...filters, keyword: e.target.value })
                }
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') {
                    // 按回车键时立即搜索，不等待防抖
                    setPrevFilters(filters)
                    setPage(1)
                    loadData(1)
                  }
                }}
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
              {filteredItems.map((item) => (
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
                    <img
                      src={item.cover?.square}
                      alt={item.title}
                      className="w-16 h-16 rounded object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div
                          className="font-semibold text-gray-800 truncate search-highlight"
                          dangerouslySetInnerHTML={{ __html: item.title }}
                        />
                        {item.downloaded && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 text-xs font-medium text-green-700 bg-green-100 border border-green-200 rounded-full whitespace-nowrap">
                            已缓存
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 truncate">
                        {item.subtitle}
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
                      {item.id}
                    </div>
                    <div>
                      <span className="text-gray-500">课程数: </span>
                      {item.article?.count} 讲
                    </div>
                    <div>
                      <span className="text-gray-500">价格: </span>
                      {item.sale_type === 6 || item.sale_type === 7
                        ? '免费'
                        : item.sale
                        ? `¥${(item.sale / 100).toFixed(2)}`
                        : '未知'}
                    </div>
                    <div>
                      <span className="text-gray-500">完结: </span>
                      {item.is_finish ? '是' : '否'}
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
            {filteredItems.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <div className="text-lg">暂无数据</div>
              </div>
            )}
            <Pagination
              current={page}
              total={total}
              pageSize={perPage}
              onChange={setPage}
              onPageSizeChange={setPerPage}
              pageSizeOptions={[12, 24, 48]}
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
            <Button onClick={handleDownloadConfirm} className="flex-1">
              确定{confirmItems.length > 1 ? ` (${confirmItems.length})` : ''}
            </Button>
          </div>
        </div>
      </Modal>

      <Drawer
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false)
          setDetailItem(null)
        }}
        title="课程详情"
        size="xl"
      >
        {detailItem && (
          <div className="space-y-6">
            {/* Course Header */}
            <div className="flex items-start gap-4 pb-4 border-b">
              <img
                src={detailItem.cover?.square}
                alt={detailItem.title}
                className="w-32 h-32 rounded-lg object-cover shadow-md"
              />
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-gray-800 mb-2">{detailItem.title}</h3>
                <p className="text-gray-600 mb-3">{detailItem.subtitle}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">作者: </span>
                    <span className="font-medium">{detailItem.author?.name}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">ID: </span>
                    <span className="font-medium">{detailItem.id}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">课程数: </span>
                    <span className="font-medium">{detailItem.article?.count} 讲</span>
                  </div>
                  <div>
                    <span className="text-gray-500">价格: </span>
                    <span className="font-medium">
                      {detailItem.sale_type === 6 || detailItem.sale_type === 7
                        ? '免费'
                        : `¥${(detailItem.sale / 100).toFixed(2)}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">完结: </span>
                    <span className="font-medium">{detailItem.is_finish ? '是' : '否'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">音频: </span>
                    <span className="font-medium">{detailItem.is_audio ? '支持' : '不支持'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">视频: </span>
                    <span className="font-medium">{detailItem.is_video ? '支持' : '不支持'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Author Introduction */}
            {detailItem.author?.intro && (
              <div className="bg-gradient-to-r from-primary-50 to-primary-100 rounded-lg p-4">
                <h4 className="font-semibold text-gray-700 mb-2 flex items-center">
                  <span className="w-1 h-5 bg-primary-400 rounded mr-2"></span>
                  作者简介
                </h4>
                <p className="text-gray-600 text-sm leading-relaxed">{detailItem.author.intro}</p>
              </div>
            )}

            {/* Course Introduction */}
            {detailItem.intro_html && (
              <div>
                <h4 className="font-semibold text-gray-700 mb-3 flex items-center">
                  <span className="w-1 h-5 bg-primary-400 rounded mr-2"></span>
                  课程介绍
                </h4>
                <div 
                  className="text-sm text-gray-600 leading-relaxed space-y-2"
                  dangerouslySetInnerHTML={{ __html: detailItem.intro_html }}
                />
              </div>
            )}

            {/* Articles List */}
            <ArticleList productId={detailItem.id} />

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              {detailItem.redirect && (
                <Button
                  variant="secondary"
                  onClick={() => window.open(detailItem.redirect, '_blank')}
                >
                  <ExternalLink size={16} className="mr-2" />
                  访问源站
                </Button>
              )}
              {geekAuth ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowDetailModal(false)
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
                    setShowDetailModal(false)
                    setShowCookieModal(true)
                  }}
                >
                  <RefreshCw size={16} className="mr-2" />
                  设置Cookie后缓存
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
