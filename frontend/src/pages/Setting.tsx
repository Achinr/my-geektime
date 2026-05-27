import React, { useEffect, useState } from 'react'
import { getSetting, updateSetting, SettingData } from '@/api/setting'
import { Button, Card, Input, Switch, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'

export const Setting: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<SettingData>({
    storage: { host: '' },
    site: {
      cache: false,
      download: false,
      download_video: true,
      download_audio: true,
      register: { type: 'name' },
      play: { type: 'origin', proxy_url: [] },
      proxy: { proxy_url: '', urls: [] },
      cookie: { geektime: '' },
    },
  })

  const { addToast } = useToast()

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const res = await getSetting()
      if (res.storage && res.site) {
        setSettings(res)
      }
    } catch (error) {
      console.error('Failed to load settings', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSetting({
        storageHost: settings.storage.host,
        siteDownload: settings.site.download_video || settings.site.download_audio,
        siteDownloadVideo: settings.site.download_video,
        siteDownloadAudio: settings.site.download_audio,
        siteCache: settings.site.cache,
        siteProxyUrl: settings.site.proxy.proxy_url,
        siteProxyUrls: settings.site.proxy.urls,
        sitePlayUrls: settings.site.play.proxy_url,
        cookie: settings.site.cookie.geektime,
      })
      addToast('保存成功', 'success')
    } catch (error) {
      addToast('保存失败，请重试', 'error')
      console.error('Failed to save settings', error)
    } finally {
      setSaving(false)
    }
  }

  const handleProxyUrlAdd = () => {
    setSettings((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        proxy: {
          ...prev.site.proxy,
          urls: [...prev.site.proxy.urls, ''],
        },
      },
    }))
  }

  const handleProxyUrlRemove = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        proxy: {
          ...prev.site.proxy,
          urls: prev.site.proxy.urls.filter((_, i) => i !== index),
        },
      },
    }))
  }

  const handleProxyUrlChange = (index: number, value: string) => {
    setSettings((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        proxy: {
          ...prev.site.proxy,
          urls: prev.site.proxy.urls.map((url, i) => (i === index ? value : url)),
        },
      },
    }))
  }

  const handlePlayUrlAdd = () => {
    setSettings((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        play: {
          ...prev.site.play,
          proxy_url: [...prev.site.play.proxy_url, ''],
        },
      },
    }))
  }

  const handlePlayUrlRemove = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        play: {
          ...prev.site.play,
          proxy_url: prev.site.play.proxy_url.filter((_, i) => i !== index),
        },
      },
    }))
  }

  const handlePlayUrlChange = (index: number, value: string) => {
    setSettings((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        play: {
          ...prev.site.play,
          proxy_url: prev.site.play.proxy_url.map((url, i) => (i === index ? value : url)),
        },
      },
    }))
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  return (
    <div>
      <Card header="系统配置" />

      <Card className="mt-4 pb-12">
        <div className="pl-4 pr-4 pt-4">

          <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Cookie设置</h3>
            <Input
              label="极客时间Cookie"
              placeholder="请输入极客时间的Cookie"
              value={settings.site.cookie.geektime}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    cookie: { ...prev.site.cookie, geektime: e.target.value },
                  },
                }))
              }
            />
          </div>

          <div className="border-t pt-3">
            <h3 className="text-lg font-medium mb-2">缓存设置</h3>
            <Input
              label="URL"
              placeholder="缓存后音视频本地播放的URL"
              value={settings.storage.host}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  storage: { ...prev.storage, host: e.target.value },
                }))
              }
            />
          </div>

          <div className="border-t pt-3 flex gap-6">
            <div className="flex-1">
              <Switch
                label="下载视频"
                checked={settings.site.download_video}
                onChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    site: { ...prev.site, download_video: checked, download: checked || prev.site.download_audio },
                  }))
                }
                onText="开启"
                offText="关闭"
              />
              <p className="text-xs text-gray-500 mt-1">
                缓存时自动下载视频文件到本地
              </p>
            </div>
            <div className="flex-1">
              <Switch
                label="下载音频"
                checked={settings.site.download_audio}
                onChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    site: { ...prev.site, download_audio: checked, download: checked || prev.site.download_video },
                  }))
                }
                onText="开启"
                offText="关闭"
              />
              <p className="text-xs text-gray-500 mt-1">
                缓存时自动下载音频文件到本地
              </p>
            </div>
            <div className="flex-1">
              <Switch
                label="下载资源"
                checked={settings.site.cache}
                onChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    site: { ...prev.site, cache: checked },
                  }))
                }
                onText="开启"
                offText="关闭"
              />
              <p className="text-xs text-gray-500 mt-1">
                根据被代理的源站URL配置规则，缓存任务时自动下载内容中的资源到本地，添加缓存任务后触发
              </p>
            </div>
          </div>

          <div className="border-t pt-3">
            <h3 className="text-lg font-medium mb-2">资源代理</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                被代理的URL
              </label>
              {settings.site.proxy.urls.map((url, index) => (
                <div key={index} className="flex gap-2 mb-2 min-w-0">
                  <Input
                    placeholder="被代理的源站URL"
                    value={url}
                    onChange={(e) => handleProxyUrlChange(index, e.target.value)}
                    className="flex-1 min-w-0"
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleProxyUrlRemove(index)}
                    className="shrink-0"
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button variant="light" size="sm" onClick={handleProxyUrlAdd}>
                添加URL
              </Button>
            </div>

            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                被代理的播放URL
              </label>
              {settings.site.play.proxy_url.map((url, index) => (
                <div key={index} className="flex gap-2 mb-2 min-w-0">
                  <Input
                    placeholder="被代理的源站播放URL"
                    value={url}
                    onChange={(e) => handlePlayUrlChange(index, e.target.value)}
                    className="flex-1 min-w-0"
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handlePlayUrlRemove(index)}
                    className="shrink-0"
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button variant="light" size="sm" onClick={handlePlayUrlAdd}>
                添加URL
              </Button>
            </div>
          </div>

          <div className="border-t pt-6 flex justify-center gap-4 mt-12 mb-6">
            <Button onClick={handleSave} disabled={saving} size="md" className="px-8 py-2.5">
              {saving ? '保存中...' : '保存'}
            </Button>
            <Button variant="light" onClick={loadSettings} size="md" className="px-8 py-2.5">
              重置
            </Button>
          </div>
        </div>
        </div>
      </Card>
    </div>
  )
}
