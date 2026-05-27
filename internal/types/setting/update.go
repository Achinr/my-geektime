package setting

type SettingUpdate struct {
	StorageHost      string   `json:"storageHost,omitempty"`
	SiteProxyURL     string   `json:"siteProxyUrl,omitempty"`
	SiteDownload     bool     `json:"siteDownload,omitempty"`
	SiteDownloadVideo bool    `json:"siteDownloadVideo,omitempty"`
	SiteDownloadAudio bool    `json:"siteDownloadAudio,omitempty"`
	SiteCache        bool     `json:"siteCache,omitempty"`
	SiteProxyUrls    []string `json:"siteProxyUrls,omitempty"`
	SitePlayUrls     []string `json:"sitePlayUrls,omitempty"`
	Cookie           string   `json:"cookie,omitempty"`
}
