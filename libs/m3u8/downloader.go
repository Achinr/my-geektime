package m3u8

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

const (
	tsFolderName     = "ts"
	tsTempFileSuffix = "_tmp"
	progressWidth    = 40
	defaultChunkSize = 10
)

// ProgressManager manages multiple concurrent download progress bars
type ProgressManager struct {
	mu       sync.Mutex
	lines    map[string]int // taskID -> line number
	nextLine int
}

var globalProgressManager = &ProgressManager{
	lines:    make(map[string]int),
	nextLine: 0,
}

// allocateLine allocates a new line for a task and returns the line number
func (pm *ProgressManager) allocateLine(taskID string) int {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if line, exists := pm.lines[taskID]; exists {
		return line
	}

	line := pm.nextLine
	pm.lines[taskID] = line
	pm.nextLine++

	// Print a newline to reserve space for this task's progress bar
	fmt.Println()

	return line
}

// updateLine updates a specific line with progress information using ANSI escape codes
func (pm *ProgressManager) updateLine(taskID string, content string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	line, exists := pm.lines[taskID]
	if !exists {
		return
	}

	// Move cursor up to the correct line
	// \033[A moves cursor up one line
	// We need to move up (nextLine - line) lines from current position
	linesToMove := globalProgressManager.nextLine - line
	if linesToMove > 0 {
		fmt.Printf("\033[%dA", linesToMove)
	}

	// Move to beginning of line, print content, and clear rest of line
	fmt.Printf("\r%s\033[K", content)

	// Move cursor back down to original position
	if linesToMove > 0 {
		fmt.Printf("\033[%dB", linesToMove)
	}
}

// drawProgressBar draws a visual progress bar with enhanced information
// Each task gets its own line to avoid conflicts in concurrent downloads
func drawProgressBar(taskID string, prefix string, proportion float32, width int, finished, total int, filename string, _ int) {
	pos := int(proportion * float32(width))
	// Truncate filename safely using rune count to avoid breaking multi-byte characters
	maxLen := 20
	runeCount := utf8.RuneCountInString(filename)
	if runeCount > maxLen {
		// Get runes and truncate - use a new variable to avoid ineffectual assignment
		runes := []rune(filename)
		truncatedFilename := "..." + string(runes[runeCount-(maxLen-3):])
		_ = truncatedFilename // Use the variable (can be used for logging or display if needed)
	}
	s := fmt.Sprintf("%s %s%*s %6.2f%% (%d/%d)",
		prefix, strings.Repeat("■", pos), width-pos, "", proportion*100, finished, total)

	// Use ProgressManager to update the specific line for this task
	// This ensures each task's progress bar stays on its own line
	globalProgressManager.updateLine(taskID, s)
}

const (
	maxRetriesPerSegment = 5 // Maximum number of retries per segment download
)

// Downloader represents an M3U8 downloader
type Downloader struct {
	lock         sync.Mutex
	queue        []int
	folder       string // Task-specific folder for TS segments
	outputDir    string // Parent directory
	tsFolder     string
	finish       int32
	currentIdx   int32 // Track current downloading segment index
	segLen       int
	concurrency  int
	filename     string // Output filename (without extension)
	headers      map[string]string
	taskID       string // Unique task identifier for progress bar display
	progressLine int    // Allocated line number for progress bar
	retryCount   map[int]int // Track retry count per segment index

	result *ParseResult
	ctx    context.Context
	cancel context.CancelFunc
	client *http.Client // Independent HTTP client for this downloader
}

// DownloadConfig holds download configuration
type DownloadConfig struct {
	Output       string
	URL          string
	ParsedResult *ParseResult // Optional: use pre-parsed result instead of URL
	Key          string
	Concurrency  int
	Headers      map[string]string
	Filename     string // Optional: explicit output filename (without extension)
	TaskIndex    string // Optional: task identifier for isolated directory
}

// NewDownloader creates a new M3U8 downloader
func NewDownloader(ctx context.Context, config DownloadConfig) (*Downloader, error) {
	var result *ParseResult
	var err error

	// Use pre-parsed result if provided, otherwise parse from URL
	if config.ParsedResult != nil {
		result = config.ParsedResult
	} else {
		// Parse M3U8 playlist
		result, err = ParseFromURL(ctx, config.URL, config.Headers)
		if err != nil {
			return nil, fmt.Errorf("parse m3u8 failed: %w", err)
		}
	}

	// Determine output folder
	folder := config.Output
	if folder == "" {
		current, err := os.Getwd()
		if err != nil {
			return nil, fmt.Errorf("get current directory failed: %w", err)
		}
		folder = filepath.Join(current, "downloads")
	}

	// Create task-specific subdirectory to avoid concurrent download conflicts
	taskFolder := folder
	if config.TaskIndex != "" {
		taskFolder = filepath.Join(folder, config.TaskIndex)
	} else if config.Filename != "" {
		// Use filename as task identifier if TaskIndex not provided
		taskFolder = filepath.Join(folder, config.Filename)
	}

	// Create folders
	if err := os.MkdirAll(taskFolder, os.ModePerm); err != nil {
		return nil, fmt.Errorf("create storage folder failed: %w", err)
	}

	tsFolder := filepath.Join(taskFolder, tsFolderName)
	if err := os.MkdirAll(tsFolder, os.ModePerm); err != nil {
		return nil, fmt.Errorf("create ts folder failed: %w", err)
	}

	// Set concurrency
	concurrency := config.Concurrency
	if concurrency <= 0 {
		concurrency = defaultChunkSize
	}

	d := &Downloader{
		folder:       taskFolder,
		outputDir:    folder,
		tsFolder:     tsFolder,
		result:       result,
		concurrency:  concurrency,
		filename:     config.Filename,
		headers:      config.Headers,
		taskID:       config.TaskIndex,                                     // Use TaskIndex as unique identifier
		progressLine: globalProgressManager.allocateLine(config.TaskIndex), // Allocate line for progress bar
		retryCount:   make(map[int]int),
		// Create independent HTTP client with larger connection pool
		client: &http.Client{
			Timeout: 60 * time.Second, // HTTP request timeout to prevent hanging
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 20,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}

	d.segLen = len(result.M3u8.Segments)
	d.queue = generateSlice(d.segLen)

	// Create context with cancel
	d.ctx, d.cancel = context.WithCancel(ctx)

	return d, nil
}

// NewDownloaderWithResult creates a downloader with pre-parsed result
func NewDownloaderWithResult(ctx context.Context, config DownloadConfig) (*Downloader, error) {
	return NewDownloader(ctx, config)
}

// Start begins the download process
func (d *Downloader) Start() error {
	defer d.cancel()

	var wg sync.WaitGroup
	limitChan := make(chan struct{}, d.concurrency)

	for {
		select {
		case <-d.ctx.Done():
			return d.ctx.Err()
		default:
		}

		tsIdx, end, err := d.next()
		if err != nil {
			if end {
				break
			}
			// Queue is empty but not finished, wait a bit
			time.Sleep(100 * time.Millisecond)
			continue
		}

		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			// Mark this segment as currently downloading
			atomic.StoreInt32(&d.currentIdx, int32(idx))
			if err := d.downloadSegment(idx); err != nil {
				// Track retry count - skip segment if exceeded max retries
				d.lock.Lock()
				d.retryCount[idx]++
				retries := d.retryCount[idx]
				d.lock.Unlock()
				if retries >= maxRetriesPerSegment {
					log.Printf("[Error] segment %d failed after %d retries, skipping: %v", idx, retries, err)
					// Mark as finished to avoid infinite waiting
					atomic.AddInt32(&d.finish, 1)
				} else {
					log.Printf("[Warn] download segment failed, will retry (%d/%d) (index: %d)", retries, maxRetriesPerSegment, idx)
					// Put back into queue for retry
					if retryErr := d.back(idx); retryErr != nil {
						log.Printf("[Error] put segment back to queue failed (index: %d)", idx)
					}
				}
			}
			<-limitChan
		}(tsIdx)

		limitChan <- struct{}{}
	}

	wg.Wait()

	// Check if all segments are downloaded
	if atomic.LoadInt32(&d.finish) != int32(d.segLen) {
		return fmt.Errorf("download incomplete: %d/%d segments",
			atomic.LoadInt32(&d.finish), d.segLen)
	}

	// Merge segments
	if err := d.mergeSegmentsToTS(); err != nil {
		return fmt.Errorf("merge segments failed: %w", err)
	}

	log.Printf("[Info] download completed successfully (output: %v/%v.ts)", d.outputDir, d.filename)

	return nil
}

// downloadSegment downloads a single TS segment
func (d *Downloader) downloadSegment(segIndex int) error {
	select {
	case <-d.ctx.Done():
		return d.ctx.Err()
	default:
	}

	tsURL := d.getTSURL(segIndex)

	// Create HTTP request with custom headers
	req, err := http.NewRequestWithContext(d.ctx, http.MethodGet, tsURL, nil)
	if err != nil {
		return fmt.Errorf("create request failed: %w", err)
	}

	// Set default headers
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	for k, v := range d.headers {
		req.Header.Set(k, v)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("request %s failed: %w", tsURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("http status %d for %s", resp.StatusCode, tsURL)
	}

	// Read response body
	tsData, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response failed: %w", err)
	}

	if len(tsData) == 0 {
		return fmt.Errorf("empty response for %s", tsURL)
	}

	// Decrypt if necessary
	segment := d.result.M3u8.Segments[segIndex]
	if segment != nil {
		keyInfo, ok := d.result.M3u8.Keys[segment.KeyIndex]
		if ok && keyInfo != nil && keyInfo.Key != "" {
			// Apply decryption based on method
			switch keyInfo.Method {
			case CryptMethodAES:
				if keyInfo.AliyunVoDEncryption {
					// Use Aliyun VOD encryption
					tsData = decryptAliyunVOD(tsData, keyInfo.Key)
				} else {
					// Standard AES-128 decryption
					decrypted, err := aes128Decrypt(tsData, []byte(keyInfo.Key), []byte(keyInfo.IV))
					if err != nil {
						return fmt.Errorf("decrypt failed: %w", err)
					}
					tsData = decrypted
				}
			}
		}
	}

	// Ensure TS file starts with sync byte 0x47
	tsData = ensureTSSyncByte(tsData)

	// Write to temporary file
	filename := getTSFilename(tsURL)
	tempPath := filepath.Join(d.tsFolder, filename+tsTempFileSuffix)
	finalPath := filepath.Join(d.tsFolder, filename)

	if err := os.WriteFile(tempPath, tsData, os.ModePerm); err != nil {
		return fmt.Errorf("write temp file failed: %w", err)
	}

	// Rename to final path
	if err := os.Rename(tempPath, finalPath); err != nil {
		return fmt.Errorf("rename file failed: %w", err)
	}

	// Update progress (show completed count and current downloading file)
	finished := atomic.AddInt32(&d.finish, 1)
	progress := float32(finished) / float32(d.segLen)
	// Show current downloading segment info with filename and task ID
	// Use taskID as prefix to distinguish concurrent downloads
	prefix := "Downloading"
	if d.taskID != "" {
		prefix = fmt.Sprintf("[%s]", d.taskID)
	}
	drawProgressBar(d.taskID, prefix, progress, progressWidth, int(finished), d.segLen, d.filename, segIndex)

	return nil
}

// next gets the next segment index to download
func (d *Downloader) next() (segIndex int, end bool, err error) {
	d.lock.Lock()
	defer d.lock.Unlock()

	if len(d.queue) == 0 {
		if atomic.LoadInt32(&d.finish) == int32(d.segLen) {
			end = true
			err = fmt.Errorf("all segments downloaded")
		} else {
			end = false
			err = fmt.Errorf("queue empty, waiting for running tasks")
		}
		return
	}

	segIndex = d.queue[0]
	d.queue = d.queue[1:]
	return
}

// back puts a segment index back into the queue for retry
func (d *Downloader) back(segIndex int) error {
	d.lock.Lock()
	defer d.lock.Unlock()

	if segIndex < 0 || segIndex >= d.segLen {
		return fmt.Errorf("invalid segment index: %d", segIndex)
	}

	d.queue = append(d.queue, segIndex)
	return nil
}

// mergeSegmentsToTS merges all downloaded TS segments into a single TS file
func (d *Downloader) mergeSegmentsToTS() error {
	// Check for missing segments
	missingCount := 0
	for i := 0; i < d.segLen; i++ {
		tsPath := filepath.Join(d.tsFolder, getTSFilename(d.getTSURL(i)))
		if _, err := os.Stat(tsPath); os.IsNotExist(err) {
			missingCount++
		}
	}

	if missingCount > 0 {
		log.Printf("[Warn] some segments are missing (missing: %d, total: %d)", missingCount, d.segLen)
	}

	// Create output TS file in parent directory (not in task subdirectory)
	var outputFile string
	if d.filename != "" {
		// Use explicitly provided filename, save to parent directory
		outputFile = filepath.Join(d.outputDir, d.filename+".ts")
	} else {
		// Fallback to extracting from URL
		outputFile = filepath.Join(d.outputDir, getOutputFilename(d.result.URL.String())+".ts")
	}
	outFile, err := os.Create(outputFile)
	if err != nil {
		return fmt.Errorf("create output file failed: %w", err)
	}
	defer outFile.Close()

	writer := bufio.NewWriter(outFile)
	mergedCount := 0

	// Merge all segments in order
	for i := 0; i < d.segLen; i++ {
		tsPath := filepath.Join(d.tsFolder, getTSFilename(d.getTSURL(i)))

		data, err := os.ReadFile(tsPath)
		if err != nil {
			log.Printf("[Warn] read segment file failed, skipping (index: %d, path: %v)", i, tsPath)
			continue
		}

		if _, err := writer.Write(data); err != nil {
			log.Printf("[Warn] write segment data failed, skipping (index: %d)", i)
			continue
		}

		mergedCount++
		progress := float32(mergedCount) / float32(d.segLen)
		// Use taskID as prefix for merge progress
		prefix := "Merging"
		if d.taskID != "" {
			prefix = fmt.Sprintf("[%s-Merge]", d.taskID)
		}
		drawProgressBar(d.taskID, prefix, progress, progressWidth, mergedCount, d.segLen, d.filename, i)
	}

	if err := writer.Flush(); err != nil {
		return fmt.Errorf("flush writer failed: %w", err)
	}

	if mergedCount != d.segLen {
		log.Printf("[Warn] merge incomplete (merged: %d, total: %d)", mergedCount, d.segLen)
	}

	log.Printf("[Info] segments merged successfully (output: %v, segments: %d)", outputFile, mergedCount)

	// Clean up TS folder
	if err := os.RemoveAll(d.tsFolder); err != nil {
		log.Printf("[Warn] remove ts folder failed (folder: %v)", d.tsFolder)
	}

	return nil
}

// getTSURL returns the URL for a specific segment
func (d *Downloader) getTSURL(segIndex int) string {
	if segIndex < 0 || segIndex >= len(d.result.M3u8.Segments) {
		return ""
	}
	segment := d.result.M3u8.Segments[segIndex]
	return resolveURL(d.result.URL, segment.URI)
}

// Helper functions

func generateSlice(length int) []int {
	s := make([]int, 0, length)
	for i := 0; i < length; i++ {
		s = append(s, i)
	}
	return s
}

func getTSFilename(tsURL string) string {
	idx := strings.Index(tsURL, "?")
	if idx > 0 {
		return filepath.Base(tsURL[:idx])
	}
	return filepath.Base(tsURL)
}

func getOutputFilename(u string) string {
	parts := strings.Split(u, "/")
	if len(parts) > 0 {
		last := parts[len(parts)-1]
		// Remove query parameters
		if idx := strings.Index(last, "?"); idx > 0 {
			last = last[:idx]
		}
		// Remove extension
		ext := filepath.Ext(last)
		if ext != "" {
			return last[:len(last)-len(ext)]
		}
		return last
	}
	return "output"
}
