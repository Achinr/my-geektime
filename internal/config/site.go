package config

type Site struct {
	Cache         bool     `json:"cache" yaml:"cache"`
	Download      bool     `json:"download" yaml:"download"`
	DownloadVideo bool     `json:"download_video" yaml:"download_video"`
	DownloadAudio bool     `json:"download_audio" yaml:"download_audio"`
	Register      Register `json:"register" yaml:"register"`
	Login         Login    `json:"login" yaml:"login"`
	Play          Play     `json:"play" yaml:"play"`
	Proxy         Proxy    `json:"proxy" yaml:"proxy"`
	Cookie        Cookie   `json:"cookie" yaml:"cookie"`
	Email         Email    `json:"email" yaml:"email"`
}

type (
	Register struct {
		Types []string      `json:"types" yaml:"types"`
		Email RegisterEmail `json:"email" yaml:"email"`
	}

	Login struct {
		Types []string   `json:"types" yaml:"types"`
		Guest LoginGuest `json:"guest" yaml:"guest"`
	}

	RegisterEmail struct {
		Subject string `json:"subject" yaml:"subject"`
		Body    string `json:"body" yaml:"body"`
		Attach  string `json:"attach" yaml:"attach"`
	}

	LoginGuest struct {
		Name  GuestAccount `json:"name" yaml:"name"`
		Email GuestAccount `json:"email" yaml:"email"`
	}

	GuestAccount struct {
		Account  string `json:"account" yaml:"account"`
		Password string `json:"password" yaml:"password"`
	}

	Play struct {
		Type     string   `json:"type" yaml:"type"`
		ProxyUrl []string `json:"proxy_url" yaml:"proxy_url"`
	}

	Proxy struct {
		Urls        []string `json:"urls" yaml:"urls"`
		ProxyUrl    string   `json:"proxy_url" yaml:"proxy_url"`
		Cache       bool     `json:"cache" yaml:"cache"`
		CachePrefix string   `json:"cache_prefix" yaml:"cache_prefix"`
	}

	Cookie struct {
		Geektime string `json:"geektime" yaml:"geektime"`
	}

	Email struct {
		SMTP SMTPConfig `json:"smtp" yaml:"smtp"`
	}

	SMTPConfig struct {
		Host     string `json:"host" yaml:"host"`
		Port     string `json:"port" yaml:"port"`
		Username string `json:"username" yaml:"username"`
		Password string `json:"password" yaml:"password"`
		From     string `json:"from" yaml:"from"`
	}
)
