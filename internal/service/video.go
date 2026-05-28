package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/JohannesKaufmann/dom"
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"github.com/golang-jwt/jwt/v4"
	"github.com/zkep/my-geektime/internal/global"
	"github.com/zkep/my-geektime/libs/m3u8"
	"github.com/zkep/my-geektime/libs/zhttp"
	"go.uber.org/zap"
	"golang.org/x/net/html"
)

func playSpec(ctx context.Context, req *PlayMetaRequest) error {
	before := func(r *http.Request) {
		r.Header.Set("Accept", "application/json, text/plain, */*")
		r.Header.Set("User-Agent", zhttp.RandomUserAgent())
		r.Header.Set("Referer", r.URL.String())
		r.Header.Set("Origin", "https://time.geekbang.org")
	}
	after := func(r *http.Response) error {
		if zhttp.IsHTTPSuccessStatus(r.StatusCode) {
			raw, err := io.ReadAll(r.Body)
			if err != nil {
				return err
			}
			req.Spec = raw
			return nil
		}
		if zhttp.IsHTTPStatusSleep(r.StatusCode) {
			time.Sleep(time.Second * 10)
		}
		if zhttp.IsHTTPStatusRetryable(r.StatusCode) {
			return fmt.Errorf("http status: %s", r.Status)
		}
		return zhttp.BreakRetryError(fmt.Errorf("break http status: %s", r.Status))
	}
	err := zhttp.NewRequest().Before(before).
		After(after).DoWithRetry(ctx, http.MethodGet, req.DowloadURL, nil)
	if err != nil {
		return err
	}
	return nil
}

func playCiphertext(ctx context.Context, req *PlayMetaRequest, uri string) error {
	before := func(r *http.Request) {
		r.Header.Set("Accept", "application/json, text/plain, */*")
		r.Header.Set("User-Agent", zhttp.RandomUserAgent())
		r.Header.Set("Referer", r.URL.String())
		r.Header.Set("Origin", "https://time.geekbang.org")
	}
	after := func(r *http.Response) error {
		if zhttp.IsHTTPSuccessStatus(r.StatusCode) {
			raw, err := io.ReadAll(r.Body)
			if err != nil {
				return err
			}
			if len(raw) == 0 {
				return fmt.Errorf("cipher key is empty %v", r.Request.URL)
			}
			req.Ciphertext = raw
			return nil
		}
		if zhttp.IsHTTPStatusSleep(r.StatusCode) {
			time.Sleep(time.Second * 10)
		}
		if zhttp.IsHTTPStatusRetryable(r.StatusCode) {
			return fmt.Errorf("http status: %s", r.Status)
		}
		return zhttp.BreakRetryError(fmt.Errorf("break http status: %s", r.Status))
	}
	err := zhttp.NewRequest().Before(before).After(after).DoWithRetry(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return err
	}
	return nil
}

func RewritePlay(ctx context.Context, req PlayMetaRequest) (*PlayMeta, error) {
	retryCtx, retryCancel := context.WithTimeout(ctx, time.Minute*3)
	defer retryCancel()

	if len(req.Spec) == 0 {
		if err := playSpec(retryCtx, &req); err != nil {
			return nil, err
		}
	}

	if len(req.Spec) == 0 {
		return nil, fmt.Errorf("[%s] hls file is zero", req.DowloadURL)
	}

	meta := PlayMeta{
		Spec:      make([]byte, 0, len(req.Spec)),
		LocalSpec: make([]byte, 0, len(req.Spec)),
		Parts:     make([]Part, 0, 10),
	}
	bio := bufio.NewReader(bytes.NewReader(req.Spec))
	for {
		line, _, err1 := bio.ReadLine()
		if err1 != nil {
			break
		}
		l, rl := string(line), string(line)
		switch {
		case strings.HasPrefix(l, "#EXT-X-KEY:METHOD=AES-128"):
			meta.CipherMethod = "AES-128"
			sps := strings.Split(l, `"`)
			token, _, er := global.JWT.TokenGenerator(func(claims jwt.MapClaims) {
				claims["task_id"] = req.TaskId
			})
			if er != nil {
				return nil, er
			}
			// Save key file in task-specific subdirectory to avoid concurrent conflicts
			destName := path.Join(req.Dir, req.Filename, "key.key")
			meta.KeyPath = global.Storage.GetKey(destName, true)
			l = fmt.Sprintf(`%s"file://%s"`, sps[0], meta.KeyPath)
			rl = fmt.Sprintf(`%s"{host}/v2/task/kms?Ciphertext=%s"`, sps[0], token)
			if len(req.Ciphertext) == 0 {
				if err := playCiphertext(retryCtx, &req, sps[1]); err != nil {
					return nil, err
				}
			}
		case strings.HasSuffix(l, ".ts"):
			playHost := req.DowloadURL[:strings.LastIndex(req.DowloadURL, "/")+1]
			if !strings.HasPrefix(l, "https://") {
				destName := path.Join(req.Dir, req.Filename, l)
				rl = playHost + l
				meta.Parts = append(meta.Parts, Part{rl, destName, false})
			} else {
				tsPath := strings.TrimPrefix(l, playHost)
				if strings.HasPrefix(tsPath, playHost) {
					rl = tsPath
				}
				l = l[strings.LastIndex(l, "/")+1:]
				destName := path.Join(req.Dir, req.Filename, tsPath)
				meta.Parts = append(meta.Parts, Part{rl, destName, false})
			}
		}
		meta.Spec = append(meta.Spec, []byte(rl+"\n")...)
		meta.LocalSpec = append(meta.LocalSpec, []byte(l+"\n")...)
	}
	if len(req.Ciphertext) > 0 {
		meta.Ciphertext = base64.StdEncoding.EncodeToString(req.Ciphertext)
	}
	return &meta, nil
}

func VideoWithM3u8(ctx context.Context, dir, fileName string, req *PlayMeta) (string, error) {

	if len(req.Parts) == 0 {
		return "", fmt.Errorf("[%s] no video segments available", fileName)
	}

	// Check if merged file already exists (cache check)
	mergedFile := path.Join(dir, fileName+".ts")
	if stat, err := global.Storage.Stat(mergedFile); err == nil && stat != nil && stat.Size() > 0 {
		global.LOG.Info("video already exists, skipping download",
			zap.String("output", mergedFile))
		return mergedFile, nil
	}

	// Extract base URL from the first segment URL
	// The key URI is usually relative to the M3U8 file location
	firstSegmentURL := req.Parts[0].Src
	// Get the directory part of the first segment URL as base URL
	lastSlashIdx := strings.LastIndex(firstSegmentURL, "/")
	var baseURL string
	if lastSlashIdx > 0 {
		baseURL = firstSegmentURL[:lastSlashIdx+1]
	} else {
		baseURL = firstSegmentURL
	}

	// If ciphertext is provided, it must be saved to a local file
	// Save key in task-specific directory (fileName subdirectory) to avoid concurrent conflicts
	var keyFilePath string
	var keyAbsPath string // Absolute path for file:// URI
	if len(req.Ciphertext) > 0 {
		// Key file should be in the task-specific subdirectory (same as ts files)
		keyFilePath = path.Join(dir, fileName, "key.key")
		// Get absolute path for file:// URI
		keyAbsPath = global.Storage.GetKey(keyFilePath, true)

		// Decode base64 ciphertext
		cipher, err := base64.StdEncoding.DecodeString(req.Ciphertext)
		if err != nil {
			return "", fmt.Errorf("decode ciphertext failed: %w", err)
		}
		// Check if key file already exists before saving
		if stat, err := global.Storage.Stat(keyFilePath); err == nil && stat != nil && stat.Size() > 0 {
			global.LOG.Info("key file already exists, skipping save", zap.String("keyPath", keyFilePath))
		} else {
			// Save key to the task-specific path
			keyReader := io.NopCloser(bytes.NewReader(cipher))
			if _, err := global.Storage.Put(keyFilePath, keyReader); err != nil {
				return "", fmt.Errorf("save key file failed: %w", err)
			}
		}
	}

	m3u8Data := req.LocalSpec
	if keyAbsPath != "" {
		// Modify Spec to use the local key file with absolute path
		m3u8Content := string(req.Spec)
		if strings.Contains(m3u8Content, "#EXT-X-KEY:") {
			lines := strings.Split(m3u8Content, "\n")
			for i, line := range lines {
				if strings.HasPrefix(line, "#EXT-X-KEY:") && strings.Contains(line, "URI=") {
					if idx := strings.Index(line, `URI="`); idx != -1 {
						endIdx := strings.Index(line[idx+5:], `"`)
						if endIdx != -1 {
							oldURI := line[idx+5 : idx+5+endIdx]
							lines[i] = strings.Replace(line, `URI="`+oldURI+`"`, `URI="file://`+keyAbsPath+`"`, 1)
						}
					}
				}
			}
			m3u8Content = strings.Join(lines, "\n")
		}
		m3u8Data = []byte(m3u8Content)
	}
	if len(m3u8Data) == 0 {
		return "", fmt.Errorf("M3U8 spec content is empty")
	}
	headers := map[string]string{
		"Referer": "https://time.geekbang.org",
		"Origin":  "https://time.geekbang.org",
	}
	// Parse M3U8 content directly from bytes
	result, err := m3u8.ParseFromBytes(ctx, m3u8Data, baseURL, headers)
	if err != nil {
		return "", fmt.Errorf("parse m3u8 content failed: %w", err)
	}

	// Configure the M3U8 downloader with parsed result
	config := m3u8.DownloadConfig{
		Output:       global.Storage.GetKey(dir, true),
		ParsedResult: result,
		Key:          req.Ciphertext,
		Filename:     fileName,
		TaskIndex:    fileName, // Use fileName as task identifier for isolated directory
		Concurrency:  20,
		Headers:      headers,
	}

	// Create downloader
	downloader, err := m3u8.NewDownloaderWithResult(ctx, config)
	if err != nil {
		return "", fmt.Errorf("create m3u8 downloader failed: %w", err)
	}

	// Start download
	global.LOG.Info("starting M3U8 download",
		zap.String("output", mergedFile))

	if err := downloader.Start(); err != nil {
		return "", fmt.Errorf("m3u8 download failed: %w", err)
	}

	// Verify the file exists
	if _, err := global.Storage.Stat(mergedFile); err != nil {
		return "", fmt.Errorf("merged file not found: %w", err)
	}

	global.LOG.Info("video download completed",
		zap.String("output", mergedFile))

	return mergedFile, nil
}

var (
	conv = converter.NewConverter()
)

func init() {
	conv.Register.Renderer(renderer, converter.PriorityStandard)
}

func renderer(_ converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
	name := dom.NodeName(n)
	switch name {
	case "video":
		var buf bytes.Buffer
		_ = html.Render(&buf, n)
		_, _ = w.WriteString(buf.String())
		return converter.RenderSuccess
	case "img":
		if _, exists := dom.GetAttribute(n, "referrerpolicy"); !exists {
			n.Attr = append(n.Attr, html.Attribute{Key: "referrerpolicy", Val: "no-referrer"})
		}
		var buf bytes.Buffer
		_ = html.Render(&buf, n)
		_, _ = w.WriteString(buf.String())
		return converter.RenderSuccess
	}
	return converter.RenderTryNext
}

func HTMLConvertMarkdown(rawHtml string) (string, error) {
	return conv.ConvertString(rawHtml)
}
