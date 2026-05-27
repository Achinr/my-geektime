import request from '@/utils/request'

export interface SettingData {
  storage: {
    host: string
  }
  site: {
    cache: boolean
    download: boolean
    download_video: boolean
    download_audio: boolean
    register: {
      type: string
    }
    play: {
      type: string
      proxy_url: string[]
    }
    proxy: {
      proxy_url: string
      urls: string[]
    }
    cookie: {
      geektime: string
    }
  }
}

export const getSetting = () => {
  return request.get<any, SettingData>('/setting/query')
}

export const updateSetting = (data: any) => {
  return request.post('/setting/update', data)
}
