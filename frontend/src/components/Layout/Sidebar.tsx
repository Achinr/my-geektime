import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  BookOpen,
  Monitor,
  Hammer,
  ChevronDown,
  User,
  LogOut,
  RefreshCw,
  X,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth'

interface MenuItem {
  label: string
  url?: string
  icon?: React.ReactNode
  children?: MenuItem[]
  visibleOn?: (roleId: number) => boolean
}

const menuItems: MenuItem[] = [
   {
     label: '我的课程',
     icon: <BookOpen size={18} />,
     children: [
       { label: '课程列表', url: '/task/list' },
     ],
   },
   {
     label: '我的收藏',
     icon: <BookOpen size={18} />,
     children: [
       { label: '收藏列表', url: '/collect/list' },
     ],
  },
  {
    label: '极客课程',
    icon: <Monitor size={18} />,
    visibleOn: (roleId) => roleId === 1,
    children: [
      { label: '体系/公开/线下大会', url: '/product/pvip' },
      { label: '每日一课', url: '/product/lesson' },
      { label: '大厂案例', url: '/product/case' },
    ],
  },
  {
    label: '系统设置',
    icon: <Hammer size={18} />,
    visibleOn: (roleId) => roleId === 1,
    children: [
      { label: '系统配置', url: '/setting' },
      { label: '用户管理', url: '/user/list' },
    ],
  },
]

export const Sidebar: React.FC = () => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showCookieModal, setShowCookieModal] = useState(false)
  const [cookie, setCookie] = useState('')
  const user = useAuthStore((state) => state.user)
  const setGeekAuth = useAuthStore((state) => state.setGeekAuth)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()

  const isVisible = (item: MenuItem) => {
    if (item.visibleOn && user?.role_id) {
      return item.visibleOn(user.role_id)
    }
    return true
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleRefreshCookie = async () => {
    if (!cookie || cookie.length < 50) {
      alert('Cookie 不少于50个字符')
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
      } else {
        alert(data.msg || 'Cookie 保存失败')
      }
    } catch (error) {
      console.error('Failed to save cookie', error)
      alert('Cookie 保存失败，请重试')
    }
  }

  const visibleItems = menuItems.filter(isVisible)

  return (
    <nav className="hidden lg:flex items-center justify-between px-6 py-3 bg-white/80 backdrop-blur-xl border-b border-white/20 relative z-10">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
      >
        <div className="p-2 bg-primary-100 rounded-lg">
          <BookOpen className="w-4 h-4 text-primary-600" />
        </div>
        <span className="text-lg font-bold text-primary-700">
          我的极客时间
        </span>
      </button>

      <div className="flex items-center gap-1">
        {visibleItems.map((item) => (
          <div
            key={item.label}
            className="relative"
            onMouseEnter={() => setActiveDropdown(item.label)}
            onMouseLeave={() => setActiveDropdown(null)}
          >
            <button
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-xl transition-colors',
                activeDropdown === item.label
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-white/50'
              )}
            >
              <span className="text-primary-500">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
              {item.children && <ChevronDown size={14} />}
            </button>
            {item.children && activeDropdown === item.label && (
              <div className="absolute top-full left-0 w-48 bg-white/95 backdrop-blur-xl rounded-xl shadow-xl border border-white/20 py-2 z-50" style={{ marginTop: '4px' }}>
                <div className="absolute -top-4 left-0 w-full h-4" />
                {item.children.map((child) => (
                  <NavLink
                    key={child.url}
                    to={child.url!}
                    className={({ isActive }) =>
                      clsx(
                        'block px-4 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-primary-50 text-primary-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      )
                    }
                  >
                    {child.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 ml-4">
        <div
          className="relative"
          onMouseEnter={() => setShowUserMenu(true)}
          onMouseLeave={() => setShowUserMenu(false)}
        >
          <button className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/50 transition-colors">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.user_name}
                className="w-8 h-8 rounded-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = 'none'
                  const parent = target.parentElement
                  if (parent) {
                    const fallback = parent.querySelector('.avatar-fallback') as HTMLElement
                    if (fallback) fallback.style.display = 'flex'
                  }
                }}
              />
            ) : null}
            <div
              className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center avatar-fallback"
              style={{ display: user?.avatar ? 'none' : 'flex' }}
            >
              <User className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700">{user?.user_name}</span>
            <ChevronDown size={14} className="text-gray-400" />
          </button>
          {showUserMenu && (
            <div className="absolute top-full right-0 w-44 bg-white/95 backdrop-blur-xl rounded-xl shadow-xl border border-white/20 py-2 z-50" style={{ marginTop: '4px' }}>
              <div className="absolute -top-4 left-0 w-full h-4" />
              <button
                onClick={() => {
                  setShowUserMenu(false)
                  setShowCookieModal(true)
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <RefreshCw size={16} />
                刷新凭证
              </button>
              <div className="mx-3 my-1 border-t border-gray-100" />
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-gray-100 transition-colors"
              >
                <LogOut size={16} />
                退出登录
              </button>
            </div>
          )}

          {/* Cookie Modal */}
          {showCookieModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">刷新凭证</h3>
                  <button
                    onClick={() => {
                      setShowCookieModal(false)
                      setCookie('')
                    }}
                    className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X size={20} className="text-gray-400" />
                  </button>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                  请输入极客时间 Cookie（从浏览器开发者工具中获取）
                </p>
                <textarea
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder="请输入 GCESS 或 _gid 等 Cookie 值"
                  className="w-full h-32 px-4 py-3 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => {
                      setShowCookieModal(false)
                      setCookie('')
                    }}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleRefreshCookie}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
