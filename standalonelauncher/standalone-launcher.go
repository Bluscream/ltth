package main

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/pkg/browser"
)

//go:embed assets/*
var assets embed.FS

// Embedded application files - uncomment to enable true standalone mode
// This will embed the entire application in the binary (~35MB + 9MB = ~44MB total)
// To enable: run build script with embedded files
const (
	// Launcher version
	launcherVersion = "1.4.0"
	
	// GitHub repository settings
	githubOwner  = "Loggableim"
	githubRepo   = "ltth_desktop2"
	githubBranch = "main"
	githubAPIURL = "https://api.github.com"
	
	// Node.js installation settings
	nodeVersion  = "20.18.1"
	nodeWinURL   = "https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip"
	nodeLinuxURL = "https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz"
	nodeMacURL   = "https://nodejs.org/dist/v20.18.1/node-v20.18.1-darwin-x64.tar.gz"
)

// Release asset naming conventions for prebuilt bundles
const (
	releaseAssetWindows = "ltth-win-x64.zip"
	releaseAssetLinux   = "ltth-linux-x64.tar.gz"
	releaseAssetMacOS   = "ltth-macos-x64.tar.gz"
)

// Compiled regex for parsing npm output (compiled once for efficiency)
var npmPackageRegex = regexp.MustCompile(`npm http (?:fetch|cache) https://registry\.npmjs\.org/([^/\s]+)`)

// GitHub Release API structures
type GitHubRelease struct {
	TagName     string                `json:"tag_name"`
	Name        string                `json:"name"`
	ZipballURL  string                `json:"zipball_url"`
	TarballURL  string                `json:"tarball_url"`
	Assets      []GitHubReleaseAsset  `json:"assets"`
	PublishedAt string                `json:"published_at"`
}

type GitHubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	ContentType        string `json:"content_type"`
}

type StandaloneLauncher struct {
	baseDir           string
	progress          int
	status            string
	clients           map[chan string]bool
	logger            *log.Logger
	skipUpdate        bool
	installChoiceChan chan string
	updateChoiceChan  chan bool
	pendingRelease    *GitHubRelease
	settings          *Settings
}

// VersionInfo stores version information
type VersionInfo struct {
	Version       string `json:"version"`
	InstalledDate string `json:"installed_date"`
	LastChecked   string `json:"last_checked"`
}

// Settings stores launcher settings
type Settings struct {
	AutoUpdate bool `json:"auto_update"`
}

// Profile represents a TikTok profile
type Profile struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	TikTokUsername string `json:"tiktok_username"`
}

// ProfilesConfig stores profile configuration
type ProfilesConfig struct {
	Active   string    `json:"active"`
	Profiles []Profile `json:"profiles"`
}

// PreflightCheckResult represents a single preflight check result
type PreflightCheckResult struct {
	Name        string `json:"name"`
	Found       bool   `json:"found"`
	Version     string `json:"version,omitempty"`
	Required    bool   `json:"required"`
	InstallHint string `json:"install_hint,omitempty"`
	AutoFixable bool   `json:"auto_fixable"`
	DownloadURL string `json:"download_url,omitempty"`
}

func NewStandaloneLauncher() *StandaloneLauncher {
	return &StandaloneLauncher{
		status:            "Initialisiere Standalone Launcher...",
		progress:          0,
		clients:           make(map[chan string]bool),
		logger:            log.New(os.Stdout, "[LTTH Standalone] ", log.LstdFlags),
		installChoiceChan: make(chan string, 1),
		updateChoiceChan:  make(chan bool, 1),
	}
}

func (sl *StandaloneLauncher) updateProgress(value int, status string) {
	sl.progress = value
	sl.status = status
	sl.logger.Printf("[%d%%] %s\n", value, status)
	
	payload := map[string]interface{}{"progress": value, "status": status}
	msgBytes, _ := json.Marshal(payload) // Safe to ignore: marshaling simple types never fails
	msg := string(msgBytes)
	for client := range sl.clients {
		select {
		case client <- msg:
		default:
		}
	}
}

func (sl *StandaloneLauncher) sendError(errMsg string) {
	payload := map[string]interface{}{"error": errMsg}
	msgBytes, _ := json.Marshal(payload) // Safe to ignore: marshaling simple types never fails
	msg := string(msgBytes)
	for client := range sl.clients {
		select {
		case client <- msg:
		default:
		}
	}
}

// sendInstallPrompt signals frontend to show install path dialog
func (sl *StandaloneLauncher) sendInstallPrompt(exeDir, systemDir string) {
	payload := map[string]interface{}{
		"type":      "install-prompt",
		"exeDir":    exeDir,
		"systemDir": systemDir,
	}
	msgBytes, _ := json.Marshal(payload) // Safe to ignore: marshaling simple types never fails
	msg := string(msgBytes)
	for client := range sl.clients {
		select {
		case client <- msg:
		default:
		}
	}
}

// sendDependencyError sends structured dependency error to frontend via SSE
func (sl *StandaloneLauncher) sendDependencyError(title, detail string, hints []string) {
	sl.logger.Printf("❌ %s: %s\n", title, detail)
	for _, hint := range hints {
		sl.logger.Printf("   💡 %s\n", hint)
	}
	
	payload := map[string]interface{}{
		"type":   "dependency-error",
		"title":  title,
		"detail": detail,
		"hints":  hints,
	}
	msgBytes, _ := json.Marshal(payload)
	msg := string(msgBytes)
	for client := range sl.clients {
		select {
		case client <- msg:
		default:
		}
	}
}

// sendUpdatePrompt signals frontend to show update dialog
func (sl *StandaloneLauncher) sendUpdatePrompt() {
	if sl.pendingRelease == nil {
		return
	}
	releaseJSON, _ := json.Marshal(sl.pendingRelease)
	msg := fmt.Sprintf(`{"type": "update-prompt", "release": %s}`, string(releaseJSON))
	for client := range sl.clients {
		select {
		case client <- msg:
		default:
		}
	}
}

// Serve the splash screen
func (sl *StandaloneLauncher) serveSplash(w http.ResponseWriter, r *http.Request) {
	tmplContent, err := assets.ReadFile("assets/splash.html")
	if err != nil {
		http.Error(w, "Failed to load splash screen", http.StatusInternalServerError)
		return
	}

	tmpl, err := template.New("splash").Parse(string(tmplContent))
	if err != nil {
		http.Error(w, "Failed to parse template", http.StatusInternalServerError)
		return
	}

	data := struct {
		Title   string
		Version string
	}{
		Title:   "LTTH Standalone Launcher",
		Version: launcherVersion,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	tmpl.Execute(w, data)
}

// SSE endpoint for progress updates
func (sl *StandaloneLauncher) handleSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Create a new channel for this client
	clientChan := make(chan string, 10)
	sl.clients[clientChan] = true

	// Remove client when connection closes
	defer func() {
		delete(sl.clients, clientChan)
		close(clientChan)
	}()

	// Send current status
	initialMsg := fmt.Sprintf(`{"progress": %d, "status": "%s"}`, sl.progress, sl.status)
	fmt.Fprintf(w, "data: %s\n\n", initialMsg)
	w.(http.Flusher).Flush()

	// Listen for updates
	for {
		select {
		case msg, ok := <-clientChan:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", msg)
			w.(http.Flusher).Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// handleInstallPrompt handles installation path choice from GUI
func (sl *StandaloneLauncher) handleInstallPrompt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	
	var req struct {
		Choice string `json:"choice"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	// Send choice to channel
	select {
	case sl.installChoiceChan <- req.Choice:
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	default:
		http.Error(w, "Channel full", http.StatusInternalServerError)
	}
}

// handleUpdatePrompt handles update confirmation from GUI
func (sl *StandaloneLauncher) handleUpdatePrompt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	
	var req struct {
		Accept bool `json:"accept"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	// Send choice to channel
	select {
	case sl.updateChoiceChan <- req.Accept:
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	default:
		http.Error(w, "Channel full", http.StatusInternalServerError)
	}
}

// handleGetRelease returns pending release information
func (sl *StandaloneLauncher) handleGetRelease(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if sl.pendingRelease != nil {
		json.NewEncoder(w).Encode(sl.pendingRelease)
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{"release": nil})
	}
}

// handleSettings handles GET/POST settings
func (sl *StandaloneLauncher) handleSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	if r.Method == http.MethodGet {
		if sl.settings == nil {
			settings, err := sl.loadSettings()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			sl.settings = settings
		}
		json.NewEncoder(w).Encode(sl.settings)
		return
	}
	
	if r.Method == http.MethodPost {
		var newSettings Settings
		if err := json.NewDecoder(r.Body).Decode(&newSettings); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		
		if err := sl.saveSettings(&newSettings); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		
		sl.settings = &newSettings
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}
	
	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// handleProfiles handles GET/POST profiles
func (sl *StandaloneLauncher) handleProfiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	if r.Method == http.MethodGet {
		profiles, err := sl.loadProfiles()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(profiles)
		return
	}
	
	if r.Method == http.MethodPost {
		var req struct {
			Active string `json:"active"`
		}
		
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		
		profiles, err := sl.loadProfiles()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		
		profiles.Active = req.Active
		
		if err := sl.saveProfiles(profiles); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}
	
	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// handleCheckUpdate checks for updates and returns the latest release info
func (sl *StandaloneLauncher) handleCheckUpdate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	release, updateAvailable, err := sl.checkForUpdates()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"updateAvailable": updateAvailable,
		"release":         release,
	})
}

// Get latest release from GitHub
func (sl *StandaloneLauncher) getLatestRelease() (*GitHubRelease, error) {
	sl.updateProgress(5, "Hole neueste Release-Version...")
	
	url := fmt.Sprintf("%s/repos/%s/%s/releases/latest",
		githubAPIURL, githubOwner, githubRepo)
	
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode == http.StatusNotFound {
		// No release found - this is expected for repos without releases
		return nil, nil
	}
	
	if resp.StatusCode != http.StatusOK {
		// Read body for error details
		bodyBytes, _ := io.ReadAll(resp.Body)
		bodyStr := string(bodyBytes)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return nil, fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, bodyStr)
	}
	
	// Read body first to provide better error messages
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}
	
	// Check if body is empty or invalid
	if len(bodyBytes) == 0 {
		return nil, fmt.Errorf("GitHub API returned empty response")
	}
	
	var release GitHubRelease
	if err := json.Unmarshal(bodyBytes, &release); err != nil {
		// Provide helpful error message with body preview
		bodyPreview := string(bodyBytes)
		if len(bodyPreview) > 100 {
			bodyPreview = bodyPreview[:100] + "..."
		}
		return nil, fmt.Errorf("failed to parse JSON response: %v (body: %s)", err, bodyPreview)
	}
	
	sl.logger.Printf("Latest release: %s (%s)\n", release.Name, release.TagName)
	return &release, nil
}

// Check if path is relevant for installation (whitelist/blacklist)
func (sl *StandaloneLauncher) isRelevantPath(path string) bool {
	// Whitelist: Only these directories and files
	whitelistPrefixes := []string{
		"app/",
		"plugins/",
		"game-engine/",
		"package.json",
		"package-lock.json",
	}
	
	// Blacklist: Never include these
	blacklistPrefixes := []string{
		// Executables
		"launcher.exe",
		"launcher-console.exe",
		"dev_launcher.exe",
		"main.js", // Root main.js is Electron entry point
		
		// Runtime directories
		"runtime/",
		"logs/",
		"data/",
		"node_modules/",
		
		// Version control and CI
		".git",
		".github/",
		".gitignore",
		
		// Build and development
		"build-src/",
		"standalonelauncher/",
		
		// Documentation
		"infos/",
		"docs/",
		"docs_archive/",
		"migration-guides/",
		"screenshots/",
		"images/",
		"README.md",
		"LICENSE",
		"CHANGELOG",
		".md",
		
		// Extra tools
		"animazingpal/",
		"sidekick/",
		"simplysign/",
		"scripts/",
		
		// Test files
		"app/test/",
		"playwright.config.js",
		
		// App-specific unnecessary files
		"app/CHANGELOG.md",
		"app/README.md",
		"app/LICENSE",
		"app/docs/",
		"app/wiki/",
	}
	
	// Check blacklist first
	for _, prefix := range blacklistPrefixes {
		// Check prefix match, or suffix match for file extensions (starting with .)
		if strings.HasPrefix(path, prefix) || (strings.HasPrefix(prefix, ".") && strings.HasSuffix(path, prefix)) {
			return false
		}
	}
	
	// Check whitelist
	for _, prefix := range whitelistPrefixes {
		if strings.HasPrefix(path, prefix) || path == prefix {
			return true
		}
	}
	
	return false
}

// Download ZIP file with progress tracking
func (sl *StandaloneLauncher) downloadZipWithProgress(url, destPath string) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	
	client := &http.Client{Timeout: 300 * time.Second} // 5 minutes for large files
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}
	
	// Create destination file
	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()
	
	// Download with progress tracking
	totalSize := resp.ContentLength
	downloaded := int64(0)
	buffer := make([]byte, 32*1024) // 32KB buffer
	lastUpdate := time.Now()
	downloadStartTime := time.Now() // Track start time for speed calculation
	
	for {
		n, err := resp.Body.Read(buffer)
		if n > 0 {
			_, writeErr := out.Write(buffer[:n])
			if writeErr != nil {
				return writeErr
			}
			downloaded += int64(n)
			
			// Update progress every 200ms to avoid too many updates (15% to 60% of total progress)
			if time.Since(lastUpdate) > 200*time.Millisecond {
				elapsed := time.Since(downloadStartTime).Seconds()
				speed := float64(downloaded) / elapsed / (1024 * 1024) // MB/s
				
				if totalSize > 0 {
					downloadProgress := int(float64(downloaded) / float64(totalSize) * 45)
					percentage := int(float64(downloaded) / float64(totalSize) * 100)
					remaining := totalSize - downloaded
					
					// Calculate ETA only if we have enough data (avoid division by zero)
					var statusMsg string
					if downloaded > 0 && elapsed > 0.5 { // Wait at least 0.5s for stable speed calculation
						eta := int(float64(remaining) / (float64(downloaded) / elapsed))
						statusMsg = fmt.Sprintf("Lade herunter... %.1f / %.1f MB (%d%%) – %.1f MB/s, ~%ds verbleibend",
							float64(downloaded)/(1024*1024),
							float64(totalSize)/(1024*1024),
							percentage,
							speed,
							eta)
					} else {
						// Early stage, no ETA yet
						statusMsg = fmt.Sprintf("Lade herunter... %.1f / %.1f MB (%d%%) – %.1f MB/s",
							float64(downloaded)/(1024*1024),
							float64(totalSize)/(1024*1024),
							percentage,
							speed)
					}
					
					sl.updateProgress(15+downloadProgress, statusMsg)
				} else {
					// Unknown size, just show downloaded amount and speed
					sl.updateProgress(15, 
						fmt.Sprintf("Lade herunter... %.1f MB – %.1f MB/s",
							float64(downloaded)/(1024*1024),
							speed))
				}
				lastUpdate = time.Now()
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	
	// Final update
	if totalSize > 0 {
		sl.updateProgress(60, 
			fmt.Sprintf("Download abgeschlossen! %.1f MB", float64(downloaded)/(1024*1024)))
	}
	
	return nil
}

// Extract release ZIP file with path filtering
func (sl *StandaloneLauncher) extractReleaseZip(zipPath string) error {
	sl.updateProgress(60, "Entpacke Release-ZIP...")
	
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("failed to open ZIP: %v", err)
	}
	defer r.Close()
	
	// Find root directory in ZIP (GitHub releases have a root folder like owner-repo-commitsha)
	var rootPrefix string
	if len(r.File) > 0 {
		firstPath := r.File[0].Name
		if idx := strings.Index(firstPath, "/"); idx > 0 {
			rootPrefix = firstPath[:idx+1]
		}
	}
	
	sl.logger.Printf("ZIP root prefix: %s\n", rootPrefix)
	
	extracted := 0
	total := len(r.File)
	
	for i, f := range r.File {
		// Strip root prefix
		relativePath := f.Name
		if rootPrefix != "" && strings.HasPrefix(relativePath, rootPrefix) {
			relativePath = strings.TrimPrefix(relativePath, rootPrefix)
		}
		
		// Skip if not relevant
		if relativePath == "" || !sl.isRelevantPath(relativePath) {
			continue
		}
		
		// Update progress (60% to 70%)
		extractProgress := 60 + int(float64(i+1)/float64(total)*10)
		sl.updateProgress(extractProgress, fmt.Sprintf("Entpacke Dateien... %d/%d", extracted+1, total))
		
		fpath := filepath.Join(sl.baseDir, relativePath)
		
		// Create directory
		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, 0755)
			continue
		}
		
		// Create parent directories
		if err := os.MkdirAll(filepath.Dir(fpath), 0755); err != nil {
			sl.logger.Printf("Failed to create directory for %s: %v\n", relativePath, err)
			continue
		}
		
		// Extract file
		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			sl.logger.Printf("Failed to create file %s: %v\n", relativePath, err)
			continue
		}
		
		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			sl.logger.Printf("Failed to open file in ZIP %s: %v\n", relativePath, err)
			continue
		}
		
		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		
		if err != nil {
			sl.logger.Printf("Failed to extract %s: %v\n", relativePath, err)
			continue
		}
		
		extracted++
	}
	
	sl.logger.Printf("Extracted %d files from ZIP\n", extracted)
	
	if extracted == 0 {
		return fmt.Errorf("no files extracted from ZIP")
	}
	
	sl.updateProgress(70, "Extraktion abgeschlossen!")
	return nil
}

// Download repository from GitHub Release
func (sl *StandaloneLauncher) downloadFromRelease() error {
	// Get latest release
	release, err := sl.getLatestRelease()
	if err != nil {
		return fmt.Errorf("Konnte Release-Info nicht abrufen: %v", err)
	}
	
	if release == nil {
		// No release found - return error to trigger fallback
		return fmt.Errorf("no release found")
	}
	
	sl.updateProgress(10, "Bereite Download vor...")
	
	// Use zipball_url for download
	downloadURL := release.ZipballURL
	sl.logger.Printf("Downloading from: %s\n", downloadURL)
	
	// Create temp directory
	tempDir := filepath.Join(sl.baseDir, "temp")
	os.MkdirAll(tempDir, 0755)
	defer os.RemoveAll(tempDir)
	
	// Download ZIP file
	zipPath := filepath.Join(tempDir, "release.zip")
	if err := sl.downloadZipWithProgress(downloadURL, zipPath); err != nil {
		return fmt.Errorf("Download fehlgeschlagen: %v", err)
	}
	
	// Extract ZIP file
	if err := sl.extractReleaseZip(zipPath); err != nil {
		return fmt.Errorf("Extraktion fehlgeschlagen: %v", err)
	}
	
	return nil
}

// Download repository directly from branch (no API calls, no rate limit)
func (sl *StandaloneLauncher) downloadFromBranch() error {
	sl.updateProgress(5, "Lade Repository-ZIP von Branch herunter...")
	
	// Direct download URL (no API call needed!)
	downloadURL := fmt.Sprintf("https://github.com/%s/%s/archive/refs/heads/%s.zip",
		githubOwner, githubRepo, githubBranch)
	
	sl.logger.Printf("Downloading from branch: %s\n", downloadURL)
	
	// Create temp directory
	tempDir := filepath.Join(sl.baseDir, "temp")
	os.MkdirAll(tempDir, 0755)
	defer os.RemoveAll(tempDir)
	
	// Download ZIP file
	zipPath := filepath.Join(tempDir, "branch.zip")
	if err := sl.downloadZipWithProgress(downloadURL, zipPath); err != nil {
		return fmt.Errorf("Branch-Download fehlgeschlagen: %v", err)
	}
	
	// Extract ZIP file (reuse existing extractReleaseZip function)
	if err := sl.extractReleaseZip(zipPath); err != nil {
		return fmt.Errorf("Extraktion fehlgeschlagen: %v", err)
	}
	
	return nil
}

// Extract embedded application files (true standalone mode)
// Download all files from GitHub
func (sl *StandaloneLauncher) downloadRepository() error {
	// Try prebuilt release artifact first (fastest, no npm install needed)
	sl.logger.Println("Trying prebuilt release artifact...")
	release, releaseErr := sl.getLatestRelease()
	if releaseErr != nil || release == nil {
		sl.logger.Printf("Could not get latest release: %v\n", releaseErr)
	} else {
		if err := sl.downloadReleaseArtifact(release); err != nil {
			sl.logger.Printf("Prebuilt artifact failed: %v\n", err)
		} else {
			sl.logger.Println("Prebuilt release artifact download successful!")
			return nil
		}
	}

	// Prebuilt artifact not available – fall back to release source download
	sl.logger.Println("Falling back to release source download...")
	if err := sl.downloadFromRelease(); err == nil {
		return nil
	}

	// Last resort: branch download
	sl.logger.Println("⚠️ Release source unavailable, falling back to branch download...")
	sl.updateProgress(5, "⚠️ Kein Release gefunden, lade direkt von Branch...")
	return sl.downloadFromBranch()
}

// Check Node.js version (minimum v20 LTS)
func (sl *StandaloneLauncher) checkNodeJSVersion(nodePath string) (bool, string, error) {
	cmd := exec.Command(nodePath, "--version")
	output, err := cmd.Output()
	if err != nil {
		return false, "", err
	}
	
	version := strings.TrimSpace(string(output))
	sl.logger.Printf("Node.js version: %s\n", version)
	
	// Parse version (format: v20.18.1)
	if !strings.HasPrefix(version, "v") {
		return false, version, fmt.Errorf("invalid version format: %s", version)
	}
	
	// Extract major version
	versionNum := strings.TrimPrefix(version, "v")
	parts := strings.Split(versionNum, ".")
	if len(parts) < 1 {
		return false, version, fmt.Errorf("invalid version format: %s", version)
	}
	
	major := 0
	fmt.Sscanf(parts[0], "%d", &major)
	
	// Check if version is at least v20
	if major >= 20 {
		return true, version, nil
	}
	
	return false, version, fmt.Errorf("Node.js version too old (need v20+, found %s)", version)
}

// Check if Node.js is installed (portable or global)
func (sl *StandaloneLauncher) checkNodeJS() (string, error) {
	sl.updateProgress(72, "Prüfe Node.js Installation...")
	
	// Check portable installation first
	portableNodePath := filepath.Join(sl.baseDir, "runtime", "node", "node")
	if runtime.GOOS == "windows" {
		portableNodePath = filepath.Join(sl.baseDir, "runtime", "node", "node.exe")
	}
	
	if _, err := os.Stat(portableNodePath); err == nil {
		// Check version
		valid, version, err := sl.checkNodeJSVersion(portableNodePath)
		if err == nil && valid {
			sl.logger.Printf("Found portable Node.js %s at: %s\n", version, portableNodePath)
			return portableNodePath, nil
		}
		sl.logger.Printf("Portable Node.js found but version check failed: %v\n", err)
	}
	
	// Check global installation
	nodePath, err := exec.LookPath("node")
	if err == nil {
		// Check version
		valid, version, err := sl.checkNodeJSVersion(nodePath)
		if err == nil && valid {
			sl.logger.Printf("Found global Node.js %s at: %s\n", version, nodePath)
			return nodePath, nil
		}
		sl.logger.Printf("Global Node.js found but version check failed: %v\n", err)
	}
	
	// Node.js not found or version too old - install portable version
	sl.updateProgress(73, "Node.js v20 LTS wird installiert...")
	return sl.installNodePortable()
}

// Install portable Node.js
func (sl *StandaloneLauncher) installNodePortable() (string, error) {
	sl.updateProgress(73, "Node.js nicht gefunden, installiere portable Version...")
	
	var downloadURL string
	var nodeExe string
	
	switch runtime.GOOS {
	case "windows":
		downloadURL = nodeWinURL
		nodeExe = "node.exe"
	case "linux":
		downloadURL = nodeLinuxURL
		nodeExe = "node"
	case "darwin":
		downloadURL = nodeMacURL
		nodeExe = "node"
	default:
		return "", fmt.Errorf("Unsupported OS: %s", runtime.GOOS)
	}
	
	sl.logger.Printf("Downloading Node.js from: %s\n", downloadURL)
	
	// Create runtime/node directory
	nodeDir := filepath.Join(sl.baseDir, "runtime", "node")
	if err := os.MkdirAll(nodeDir, 0755); err != nil {
		return "", fmt.Errorf("Konnte Node.js-Verzeichnis nicht erstellen: %v", err)
	}
	
	// Download Node.js with progress tracking
	sl.updateProgress(74, "Lade Node.js herunter...")
	
	resp, err := http.Get(downloadURL)
	if err != nil {
		return "", fmt.Errorf("Node.js Download fehlgeschlagen: %v", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Node.js Download fehlgeschlagen: Status %d", resp.StatusCode)
	}
	
	// Save to temp file with progress
	tempFile := filepath.Join(sl.baseDir, "runtime", "node-temp.zip")
	out, err := os.Create(tempFile)
	if err != nil {
		return "", fmt.Errorf("Konnte temporäre Datei nicht erstellen: %v", err)
	}
	
	totalSize := resp.ContentLength
	downloaded := int64(0)
	buffer := make([]byte, 32*1024)
	lastUpdate := time.Now()
	
	for {
		n, err := resp.Body.Read(buffer)
		if n > 0 {
			_, writeErr := out.Write(buffer[:n])
			if writeErr != nil {
				out.Close()
				return "", writeErr
			}
			downloaded += int64(n)
			
			// Update progress every 200ms to avoid too many updates (74% to 77%)
			if time.Since(lastUpdate) > 200*time.Millisecond {
				if totalSize > 0 {
					downloadProgress := int(float64(downloaded) / float64(totalSize) * 3)
					percentage := int(float64(downloaded) / float64(totalSize) * 100)
					sl.updateProgress(74+downloadProgress,
						fmt.Sprintf("Lade Node.js herunter... %.1f / %.1f MB (%d%%)",
							float64(downloaded)/(1024*1024),
							float64(totalSize)/(1024*1024),
							percentage))
				} else {
					sl.updateProgress(74,
						fmt.Sprintf("Lade Node.js herunter... %.1f MB",
							float64(downloaded)/(1024*1024)))
				}
				lastUpdate = time.Now()
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			out.Close()
			return "", err
		}
	}
	out.Close()
	
	// Final update
	if totalSize > 0 {
		sl.updateProgress(77, fmt.Sprintf("Node.js Download abgeschlossen! %.1f MB", float64(downloaded)/(1024*1024)))
	}
	
	// Extract zip file
	sl.updateProgress(78, "Entpacke Node.js...")
	if err := sl.extractZip(tempFile, nodeDir); err != nil {
		return "", fmt.Errorf("Node.js Extraktion fehlgeschlagen: %v", err)
	}
	
	// Clean up temp file
	os.Remove(tempFile)
	
	// Find node executable
	nodePath := filepath.Join(nodeDir, nodeExe)
	if _, err := os.Stat(nodePath); os.IsNotExist(err) {
		// Try in subdirectory (node download includes a root folder)
		entries, _ := os.ReadDir(nodeDir)
		for _, entry := range entries {
			if entry.IsDir() {
				testPath := filepath.Join(nodeDir, entry.Name(), nodeExe)
				if _, err := os.Stat(testPath); err == nil {
					// Flatten structure: move everything up one level
					subDir := filepath.Join(nodeDir, entry.Name())
					items, _ := os.ReadDir(subDir)
					for _, item := range items {
						oldPath := filepath.Join(subDir, item.Name())
						newPath := filepath.Join(nodeDir, item.Name())
						os.Rename(oldPath, newPath)
					}
					os.Remove(subDir)
					nodePath = filepath.Join(nodeDir, nodeExe)
					break
				}
			}
		}
	}
	
	if _, err := os.Stat(nodePath); os.IsNotExist(err) {
		return "", fmt.Errorf("Node.js executable nicht gefunden nach Installation")
	}
	
	// Verify version
	valid, version, err := sl.checkNodeJSVersion(nodePath)
	if err != nil || !valid {
		return "", fmt.Errorf("Node.js Version-Check fehlgeschlagen: %v", err)
	}
	
	sl.logger.Printf("Node.js %s successfully installed at: %s\n", version, nodePath)
	sl.updateProgress(79, fmt.Sprintf("Node.js %s erfolgreich installiert!", version))
	return nodePath, nil
}

// Extract zip file
func (sl *StandaloneLauncher) extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	
	for _, f := range r.File {
		fpath := filepath.Join(destDir, f.Name)
		
		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, os.ModePerm)
			continue
		}
		
		if err := os.MkdirAll(filepath.Dir(fpath), os.ModePerm); err != nil {
			return err
		}
		
		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}
		
		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}
		
		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		
		if err != nil {
			return err
		}
	}
	
	return nil
}

// resolveReleaseAssetName returns the platform-specific prebuilt bundle filename.
func (sl *StandaloneLauncher) resolveReleaseAssetName() (string, error) {
	switch runtime.GOOS {
	case "windows":
		return releaseAssetWindows, nil
	case "linux":
		return releaseAssetLinux, nil
	case "darwin":
		return releaseAssetMacOS, nil
	default:
		return "", fmt.Errorf("Nicht unterstützte Plattform: %s", runtime.GOOS)
	}
}

// verifyFileSHA256 computes the SHA256 hash of the file at filePath and compares it
// (case-insensitive) with expectedHash. Returns an error on mismatch.
func (sl *StandaloneLauncher) verifyFileSHA256(filePath, expectedHash string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("Konnte Datei für SHA256-Prüfung nicht öffnen: %v", err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return fmt.Errorf("SHA256-Berechnung fehlgeschlagen: %v", err)
	}

	actual := hex.EncodeToString(h.Sum(nil))
	sl.logger.Printf("SHA256 of %s: %s\n", filepath.Base(filePath), actual)

	if !strings.EqualFold(actual, expectedHash) {
		return fmt.Errorf("SHA256-Prüfsumme stimmt nicht überein: erwartet %s, erhalten %s", expectedHash, actual)
	}
	return nil
}

// downloadChecksums looks for a checksums.txt asset in the release, downloads it, and
// returns the expected hash for assetName. Returns an error if not found.
func (sl *StandaloneLauncher) downloadChecksums(release *GitHubRelease, assetName string) (string, error) {
	var checksumURL string
	for _, asset := range release.Assets {
		if asset.Name == "checksums.txt" {
			checksumURL = asset.BrowserDownloadURL
			break
		}
	}
	if checksumURL == "" {
		return "", fmt.Errorf("checksums.txt not found in release assets")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(checksumURL)
	if err != nil {
		return "", fmt.Errorf("Download von checksums.txt fehlgeschlagen: %v", err)
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		// Standard sha256sum format: "<hash>  <filename>" or "<hash> *<filename>"
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		hash := parts[0]
		name := strings.TrimPrefix(parts[1], "*")
		if name == assetName {
			return hash, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("Fehler beim Lesen von checksums.txt: %v", err)
	}
	return "", fmt.Errorf("Kein Eintrag für %s in checksums.txt gefunden", assetName)
}

// extractPrebuiltZip extracts a prebuilt ZIP bundle directly into sl.baseDir.
func (sl *StandaloneLauncher) extractPrebuiltZip(zipPath string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("Konnte ZIP nicht öffnen: %v", err)
	}
	defer r.Close()

	total := len(r.File)
	extracted := 0

	for i, f := range r.File {
		// Security: use filepath.Clean to prevent path traversal
		fpath := filepath.Join(sl.baseDir, f.Name)
		if !strings.HasPrefix(filepath.Clean(fpath)+string(os.PathSeparator), filepath.Clean(sl.baseDir)+string(os.PathSeparator)) {
			sl.logger.Printf("Skipping potentially unsafe path: %s\n", f.Name)
			continue
		}

		progress := 60 + int(float64(i)/float64(total)*30)
		sl.updateProgress(progress, fmt.Sprintf("Entpacke Prebuilt-Bundle... %d/%d", i+1, total))

		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, os.ModePerm)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(fpath), os.ModePerm); err != nil {
			return err
		}

		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()

		if err != nil {
			return err
		}
		extracted++
	}

	sl.logger.Printf("Extracted %d files from prebuilt ZIP\n", extracted)
	if extracted == 0 {
		return fmt.Errorf("Keine Dateien aus dem Prebuilt-ZIP extrahiert")
	}
	return nil
}

// extractTarGz extracts a .tar.gz archive to destDir.
func (sl *StandaloneLauncher) extractTarGz(tarPath, destDir string) error {
	f, err := os.Open(tarPath)
	if err != nil {
		return fmt.Errorf("Konnte Archiv nicht öffnen: %v", err)
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("Gzip-Reader fehlgeschlagen: %v", err)
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	extracted := 0
	i := 0

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("Fehler beim Lesen des Tar-Archivs: %v", err)
		}

		// Security: use filepath.Clean to prevent path traversal
		fpath := filepath.Join(destDir, header.Name)
		if !strings.HasPrefix(filepath.Clean(fpath)+string(os.PathSeparator), filepath.Clean(destDir)+string(os.PathSeparator)) {
			sl.logger.Printf("Skipping potentially unsafe path: %s\n", header.Name)
			continue
		}

		i++
		sl.updateProgress(60+int(float64(i%300)/300.0*30), fmt.Sprintf("Entpacke Prebuilt-Bundle... %s", header.Name))

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(fpath, os.FileMode(header.Mode)); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(fpath), os.ModePerm); err != nil {
				return err
			}
			outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(outFile, tr)
			outFile.Close()
			if copyErr != nil {
				return copyErr
			}
			extracted++
		}
	}

	sl.logger.Printf("Extracted %d files from tar.gz\n", extracted)
	if extracted == 0 {
		return fmt.Errorf("Keine Dateien aus dem Prebuilt-Archiv extrahiert")
	}
	return nil
}

// extractPrebuiltBundle dispatches to the correct extractor based on file extension.
func (sl *StandaloneLauncher) extractPrebuiltBundle(archivePath string) error {
	sl.updateProgress(60, "Entpacke Prebuilt-Bundle...")
	name := strings.ToLower(archivePath)
	if strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz") {
		return sl.extractTarGz(archivePath, sl.baseDir)
	}
	return sl.extractPrebuiltZip(archivePath)
}

// assetNames returns just the Name field from each release asset (for error messages).
func assetNames(assets []GitHubReleaseAsset) []string {
	names := make([]string, len(assets))
	for i, a := range assets {
		names[i] = a.Name
	}
	return names
}

// downloadReleaseArtifact downloads, optionally verifies, and extracts the prebuilt
// platform bundle from the given GitHub release.
func (sl *StandaloneLauncher) downloadReleaseArtifact(release *GitHubRelease) error {
	assetName, err := sl.resolveReleaseAssetName()
	if err != nil {
		return err
	}

	sl.logger.Printf("Looking for release asset: %s\n", assetName)

	var found *GitHubReleaseAsset
	for i := range release.Assets {
		if release.Assets[i].Name == assetName {
			found = &release.Assets[i]
			break
		}
	}
	if found == nil {
		return fmt.Errorf("Release-Asset '%s' nicht gefunden. Verfügbare Assets: %v", assetName, assetNames(release.Assets))
	}

	sl.logger.Printf("Found release asset: %s (%d bytes)\n", found.Name, found.Size)

	// Try to get checksum (non-fatal if unavailable)
	expectedHash, checksumErr := sl.downloadChecksums(release, assetName)
	if checksumErr != nil {
		sl.logger.Printf("Warning: Could not get checksum: %v\n", checksumErr)
	}

	// Prepare temp directory
	tempDir := filepath.Join(sl.baseDir, "temp")
	os.MkdirAll(tempDir, 0755)
	defer os.RemoveAll(tempDir)

	sl.updateProgress(10, fmt.Sprintf("Lade Prebuilt-Bundle herunter: %s", assetName))

	archivePath := filepath.Join(tempDir, assetName)
	if err := sl.downloadZipWithProgress(found.BrowserDownloadURL, archivePath); err != nil {
		return fmt.Errorf("Download des Prebuilt-Bundles fehlgeschlagen: %v", err)
	}

	// Verify integrity if we have a checksum
	if expectedHash != "" {
		sl.updateProgress(61, "Verifiziere Integrität (SHA256)...")
		if err := sl.verifyFileSHA256(archivePath, expectedHash); err != nil {
			return err
		}
	}

	return sl.extractPrebuiltBundle(archivePath)
}

// findNpmPath finds npm binary path relative to Node.js or in system PATH
func (sl *StandaloneLauncher) findNpmPath(nodePath string) string {
	// Try portable npm first (relative to Node.js binary)
	if runtime.GOOS == "windows" {
		portableNpm := filepath.Join(filepath.Dir(nodePath), "npm.cmd")
		if _, err := os.Stat(portableNpm); err == nil {
			return portableNpm
		}
	} else {
		portableNpm := filepath.Join(filepath.Dir(nodePath), "npm")
		if _, err := os.Stat(portableNpm); err == nil {
			return portableNpm
		}
	}
	
	// Fallback to system npm
	return "npm"
}

// analyzeNpmError analyzes npm stderr and returns actionable hints
func (sl *StandaloneLauncher) analyzeNpmError(stderr string) []string {
	hints := []string{}
	stderrLower := strings.ToLower(stderr)
	
	// Check for specific error patterns
	if strings.Contains(stderrLower, "node-gyp") || strings.Contains(stderrLower, "gyp err") {
		hints = append(hints, "node-gyp Fehler erkannt: Build-Tools fehlen")
		if runtime.GOOS == "windows" {
			hints = append(hints, "Windows: Installiere Python 3 und Visual C++ Build Tools")
			hints = append(hints, "  → winget install Python.Python.3.12")
			hints = append(hints, "  → winget install Microsoft.VisualStudio.2022.BuildTools --override \"--add Microsoft.VisualStudio.Workload.VCTools\"")
		} else {
			hints = append(hints, "Linux/Mac: Installiere build-essential/Xcode Command Line Tools")
		}
	}
	
	if strings.Contains(stderrLower, "python") && (strings.Contains(stderrLower, "not found") || strings.Contains(stderrLower, "kann nicht gefunden werden")) {
		hints = append(hints, "Python nicht gefunden")
		if runtime.GOOS == "windows" {
			hints = append(hints, "  → winget install Python.Python.3.12")
		} else {
			hints = append(hints, "  → sudo apt install python3 (Ubuntu/Debian)")
			hints = append(hints, "  → brew install python3 (macOS)")
		}
	}
	
	if strings.Contains(stderrLower, "msbuild") || strings.Contains(stderrLower, "cl.exe") {
		hints = append(hints, "Visual C++ Compiler nicht gefunden")
		hints = append(hints, "  → winget install Microsoft.VisualStudio.2022.BuildTools --override \"--add Microsoft.VisualStudio.Workload.VCTools\"")
	}
	
	if strings.Contains(stderrLower, "eacces") || strings.Contains(stderrLower, "eperm") {
		hints = append(hints, "Fehlende Berechtigungen: Als Administrator/root starten")
	}
	
	if strings.Contains(stderrLower, "enoent") && strings.Contains(stderrLower, "npm") {
		hints = append(hints, "npm nicht gefunden: Node.js neu installieren")
	}
	
	if strings.Contains(stderrLower, "etimedout") || strings.Contains(stderrLower, "econnreset") {
		hints = append(hints, "Netzwerkfehler: Internet-Verbindung und Firewall prüfen")
		hints = append(hints, "  → Proxy-Einstellungen: npm config set proxy http://proxy:port")
	}
	
	// Fallback if no specific error detected
	if len(hints) == 0 {
		hints = append(hints, "Versuche manuelle Installation:")
		hints = append(hints, "  1. Öffne Terminal/Eingabeaufforderung")
		hints = append(hints, "  2. Navigiere zum app-Verzeichnis")
		hints = append(hints, "  3. Führe aus: npm install --omit=dev --no-optional --no-audit --no-fund")
		hints = append(hints, "  4. Bei Fehlern: npm install --verbose für Details")
	}
	
	return hints
}

// runPreflightChecks performs system dependency checks before npm install
func (sl *StandaloneLauncher) runPreflightChecks(nodePath string) ([]PreflightCheckResult, bool) {
	sl.logger.Println("Running pre-flight system checks...")
	sl.updateProgress(72, "🔍 Prüfe System-Abhängigkeiten...")
	
	results := []PreflightCheckResult{}
	allPassed := true
	
	// 1. Check Node.js version
	nodeOk, nodeVer, err := sl.checkNodeJSVersion(nodePath)
	nodeResult := PreflightCheckResult{
		Name:        "Node.js v20+",
		Found:       nodeOk && err == nil,
		Version:     nodeVer,
		Required:    true,
		InstallHint: "Node.js wird automatisch installiert",
		AutoFixable: true,
	}
	if !nodeResult.Found {
		allPassed = false
	}
	results = append(results, nodeResult)
	
	// 2. Check npm
	npmPath := sl.findNpmPath(nodePath)
	var npmCmd *exec.Cmd
	if runtime.GOOS == "windows" {
		npmCmd = exec.Command("cmd", "/C", npmPath, "--version")
	} else {
		npmCmd = exec.Command(npmPath, "--version")
	}
	npmOutput, npmErr := npmCmd.CombinedOutput()
	npmVersion := ""
	if npmErr == nil {
		npmVersion = strings.TrimSpace(string(npmOutput))
	}
	npmResult := PreflightCheckResult{
		Name:        "npm",
		Found:       npmErr == nil,
		Version:     npmVersion,
		Required:    true,
		InstallHint: "npm wird mit Node.js mitgeliefert",
		AutoFixable: true,
	}
	if !npmResult.Found {
		allPassed = false
	}
	results = append(results, npmResult)
	
	// 3. Check Python 3
	pythonFound := false
	pythonVersion := ""
	for _, pythonCmd := range []string{"python", "python3"} {
		cmd := exec.Command(pythonCmd, "--version")
		output, err := cmd.CombinedOutput()
		if err == nil {
			pythonVersion = strings.TrimSpace(string(output))
			if strings.Contains(pythonVersion, "Python 3") {
				pythonFound = true
				break
			}
		}
	}
	pythonResult := PreflightCheckResult{
		Name:        "Python 3.x",
		Found:       pythonFound,
		Version:     pythonVersion,
		Required:    true,
		InstallHint: "Benötigt für node-gyp (better-sqlite3 Kompilierung)",
		AutoFixable: false,
		DownloadURL: "https://www.python.org/downloads/",
	}
	if runtime.GOOS == "windows" {
		pythonResult.InstallHint += "\n  → winget install Python.Python.3.12"
	}
	if !pythonResult.Found {
		allPassed = false
	}
	results = append(results, pythonResult)
	
	// 4. Check Visual C++ Build Tools (Windows only)
	if runtime.GOOS == "windows" {
		vcFound := false
		vcVersion := ""
		
		// Try vswhere.exe
		vswhere := filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft Visual Studio", "Installer", "vswhere.exe")
		if _, err := os.Stat(vswhere); err == nil {
			cmd := exec.Command(vswhere, "-latest", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationVersion")
			output, err := cmd.CombinedOutput()
			if err == nil && len(output) > 0 {
				vcVersion = strings.TrimSpace(string(output))
				vcFound = true
			}
		}
		
		// Fallback: Check common installation paths
		if !vcFound {
			buildToolsPaths := []string{
				filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft Visual Studio", "2022", "BuildTools"),
				filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft Visual Studio", "2019", "BuildTools"),
				filepath.Join(os.Getenv("ProgramFiles"), "Microsoft Visual Studio", "2022", "BuildTools"),
			}
			for _, path := range buildToolsPaths {
				if _, err := os.Stat(path); err == nil {
					vcFound = true
					vcVersion = "Installed"
					break
				}
			}
		}
		
		// Fallback: Check npm config
		if !vcFound {
			cmd := exec.Command("cmd", "/C", "npm", "config", "get", "msvs_version")
			output, err := cmd.CombinedOutput()
			if err == nil && !strings.Contains(string(output), "undefined") {
				vcVersion = strings.TrimSpace(string(output))
				vcFound = true
			}
		}
		
		vcResult := PreflightCheckResult{
			Name:        "Visual C++ Build Tools",
			Found:       vcFound,
			Version:     vcVersion,
			Required:    true,
			InstallHint: "Benötigt für native Node.js Module (better-sqlite3)\n  → winget install Microsoft.VisualStudio.2022.BuildTools --override \"--add Microsoft.VisualStudio.Workload.VCTools\"",
			AutoFixable: false,
			DownloadURL: "https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022",
		}
		if !vcResult.Found {
			allPassed = false
		}
		results = append(results, vcResult)
	}
	
	// 5. Check Port 3000 availability
	portAvailable := true
	conn, err := net.DialTimeout("tcp", "localhost:3000", 2*time.Second)
	if err == nil {
		// Port is in use
		conn.Close()
		portAvailable = false
	}
	portResult := PreflightCheckResult{
		Name:        "Port 3000 verfügbar",
		Found:       portAvailable,
		Version:     "",
		Required:    false,
		InstallHint: "Port 3000 ist bereits belegt - LTTH wird möglicherweise nicht starten können",
		AutoFixable: false,
	}
	results = append(results, portResult)
	
	// Send results to frontend
	payload := map[string]interface{}{
		"type":      "preflight-results",
		"results":   results,
		"allPassed": allPassed,
	}
	msgBytes, _ := json.Marshal(payload)
	msg := string(msgBytes)
	for client := range sl.clients {
		select {
		case client <- msg:
		default:
		}
	}
	
	// Log results
	sl.logger.Println("Pre-flight check results:")
	for _, result := range results {
		status := "✅"
		if !result.Found {
			if result.Required {
				status = "❌"
			} else {
				status = "⚠️"
			}
		}
		sl.logger.Printf("  %s %s: %v (Version: %s)\n", status, result.Name, result.Found, result.Version)
	}
	
	return results, allPassed
}

// Install dependencies
func (sl *StandaloneLauncher) installDependencies(appDir string) error {
	sl.updateProgress(80, "🔄 Installiere Abhängigkeiten...")
	
	// Check if better-sqlite3 is already compiled
	betterSqlitePath := filepath.Join(appDir, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node")
	if _, err := os.Stat(betterSqlitePath); err == nil {
		sl.logger.Println("better-sqlite3 already compiled, skipping npm install")
		sl.updateProgress(90, "✓ Abhängigkeiten bereits installiert!")
		return nil
	}
	
	// Determine npm path - prefer portable installation
	npmCmd := "npm"
	nodeDir := ""
	
	if runtime.GOOS == "windows" {
		portableNpm := filepath.Join(sl.baseDir, "runtime", "node", "npm.cmd")
		if _, err := os.Stat(portableNpm); err == nil {
			npmCmd = portableNpm
			nodeDir = filepath.Join(sl.baseDir, "runtime", "node")
			sl.logger.Printf("Using portable npm: %s\n", npmCmd)
		}
	} else {
		portableNpm := filepath.Join(sl.baseDir, "runtime", "node", "bin", "npm")
		if _, err := os.Stat(portableNpm); err == nil {
			npmCmd = portableNpm
			nodeDir = filepath.Join(sl.baseDir, "runtime", "node", "bin")
			sl.logger.Printf("Using portable npm: %s\n", npmCmd)
		}
	}
	
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/C", npmCmd, "install", "--omit=dev", "--no-optional", "--no-audit", "--no-fund", "--loglevel=info")
	} else {
		cmd = exec.Command(npmCmd, "install", "--omit=dev", "--no-optional", "--no-audit", "--no-fund", "--loglevel=info")
	}
	cmd.Dir = appDir
	
	// Add portable node to PATH so node-gyp and other tools can find node
	if nodeDir != "" {
		env := os.Environ()
		pathFound := false
		for i, e := range env {
			// Check for PATH= in a way that works on both Windows (case-insensitive) and Unix (case-sensitive)
			// On Windows, PATH can be PATH=, Path=, or path=
			// On Unix, it's always PATH=
			var pathPrefix string
			if runtime.GOOS == "windows" {
				// Check if string is at least 5 chars to safely access e[:5]
				if len(e) >= 5 && strings.ToUpper(e[:5]) == "PATH=" {
					pathPrefix = e[:5] // Preserve original case (e.g., "PATH=", "Path=", "path=")
					pathValue := e[5:]
					// Prepend nodeDir to PATH to ensure it takes precedence
					env[i] = pathPrefix + nodeDir + string(os.PathListSeparator) + pathValue
					pathFound = true
					break
				}
			} else {
				// Check if string is at least 5 chars to safely access e[:5]
				if len(e) >= 5 && e[:5] == "PATH=" {
					pathValue := e[5:]
					// Prepend nodeDir to PATH to ensure it takes precedence
					env[i] = "PATH=" + nodeDir + string(os.PathListSeparator) + pathValue
					pathFound = true
					break
				}
			}
		}
		if !pathFound {
			env = append(env, "PATH="+nodeDir)
		}
		cmd.Env = env
	}
	
	// Capture stdout and stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %v", err)
	}
	
	sl.logger.Printf("Running npm install in: %s\n", appDir)
	
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("npm install fehlgeschlagen: %v", err)
	}
	
	packageCount := 0
	lastUpdate := time.Now()
	lastOutput := time.Now()
	stderrBuffer := ""
	
	// Channel to signal when goroutines are done
	done := make(chan bool, 2)
	
	// Heartbeat goroutine - monitors npm activity
	heartbeatDone := make(chan bool)
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatDone:
				return
			case <-ticker.C:
				timeSinceOutput := time.Since(lastOutput)
				if timeSinceOutput > 10*time.Second {
					sl.updateProgress(sl.progress, fmt.Sprintf("⏳ npm install läuft... (kein Output seit %ds, bitte warten)", int(timeSinceOutput.Seconds())))
				}
			}
		}
	}()
	
	// Timeout watchdog - kills npm after 10 minutes
	timeoutDone := make(chan bool)
	go func() {
		select {
		case <-timeoutDone:
			return
		case <-time.After(10 * time.Minute):
			sl.logger.Println("⏱️ npm install timeout (10 minutes) - killing process")
			sl.sendDependencyError(
				"npm install Timeout",
				"npm install wurde nach 10 Minuten abgebrochen. Dies deutet auf fehlende Build-Tools oder Netzwerkprobleme hin.",
				[]string{
					"Prüfe, ob Python 3 installiert ist: python --version",
					"Prüfe, ob Visual C++ Build Tools installiert sind (Windows)",
					"Prüfe deine Internet-Verbindung und Firewall-Einstellungen",
					"Versuche manuell: npm install --omit=dev --no-optional --verbose",
				},
			)
			cmd.Process.Kill()
		}
	}()
	
	// Read stdout in goroutine
	go func() {
		defer func() { done <- true }()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			sl.logger.Println(line)
			lastOutput = time.Now()
			
			// Extract package name from npm output
			matches := npmPackageRegex.FindStringSubmatch(line)
			if len(matches) > 1 {
				packageName := matches[1]
				packageCount++
				
				// Update progress every package, but throttle SSE updates to every 500ms
				if time.Since(lastUpdate) > 500*time.Millisecond {
					// Progress from 80% to 89% based on package count
					// Cap at 89% to ensure we don't reach 90% before completion
					progressPercent := 80 + (packageCount / 10)
					if progressPercent > 89 {
						progressPercent = 89
					}
					
					status := fmt.Sprintf("🔄 Lade %s... (%d Pakete)", packageName, packageCount)
					sl.updateProgress(progressPercent, status)
					lastUpdate = time.Now()
				}
			}
		}
	}()
	
	// Read stderr
	go func() {
		defer func() { done <- true }()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			sl.logger.Println(line)
			stderrBuffer += line + "\n"
			lastOutput = time.Now()
		}
	}()
	
	// Wait for both goroutines to finish reading
	// This must happen before cmd.Wait() to ensure pipes are fully drained
	<-done
	<-done
	
	// Stop heartbeat and timeout watchdogs
	close(heartbeatDone)
	close(timeoutDone)
	
	// Wait for command to complete
	err = cmd.Wait()
	
	if err != nil {
		// Analyze npm error and provide helpful hints
		hints := sl.analyzeNpmError(stderrBuffer)
		sl.sendDependencyError(
			"npm install fehlgeschlagen",
			fmt.Sprintf("npm install ist mit einem Fehler beendet worden: %v", err),
			hints,
		)
		return fmt.Errorf("npm install fehlgeschlagen: %v", err)
	}
	
	sl.updateProgress(90, fmt.Sprintf("✓ Abhängigkeiten installiert! (%d Pakete)", packageCount))
	return nil
}

// Start the application
func (sl *StandaloneLauncher) startApplication(nodePath, appDir string) error {
	sl.updateProgress(95, "Starte Anwendung...")
	
	launchJS := filepath.Join(appDir, "launch.js")
	cmd := exec.Command(nodePath, launchJS)
	cmd.Dir = appDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	
	sl.logger.Printf("Starting application: %s %s\n", nodePath, launchJS)
	
	err := cmd.Start()
	if err != nil {
		return fmt.Errorf("Anwendungsstart fehlgeschlagen: %v", err)
	}
	
	sl.updateProgress(100, "Anwendung gestartet!")
	
	// Wait a moment before opening browser
	time.Sleep(3 * time.Second)
	
	// Open browser to the app
	browser.OpenURL("http://localhost:3000")
	
	// Wait for the application to finish
	return cmd.Wait()
}

// getInstallDir determines the installation directory
// If portable.txt exists next to the executable, uses portable mode (same directory)
// Otherwise uses system directory (installer mode)
func (sl *StandaloneLauncher) getInstallDir() (string, error) {
	// Get executable path
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("Kann Programmverzeichnis nicht ermitteln: %v", err)
	}
	
	exeDir := filepath.Dir(exePath)
	
	// Check for portable mode marker file
	portableMarker := filepath.Join(exeDir, "portable.txt")
	if _, err := os.Stat(portableMarker); err == nil {
		// Portable mode: use executable directory
		sl.logger.Printf("Portable mode detected (portable.txt found)\n")
		return exeDir, nil
	}
	
	// Check if we have an existing installation (version.json exists)
	// in the system directory
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("Kann Konfigurationsverzeichnis nicht ermitteln: %v", err)
	}
	
	systemInstallDir := filepath.Join(userConfigDir, "PupCid", "LTTH-Launcher")
	versionFile := filepath.Join(systemInstallDir, "version.json")
	
	// If version.json exists in system dir, use that directory
	if _, err := os.Stat(versionFile); err == nil {
		sl.logger.Printf("Existing installation found in system directory\n")
		return systemInstallDir, nil
	}
	
	// First installation - wait for user choice via GUI
	installDir, err := sl.waitForInstallationPath(exeDir, systemInstallDir)
	if err != nil {
		return "", err
	}
	
	// Create directory if it doesn't exist
	if err := os.MkdirAll(installDir, 0755); err != nil {
		return "", fmt.Errorf("Kann Installationsverzeichnis nicht erstellen: %v", err)
	}
	
	sl.logger.Printf("Using installation directory: %s\n", installDir)
	return installDir, nil
}

// waitForInstallationPath waits for user to choose installation directory via GUI
func (sl *StandaloneLauncher) waitForInstallationPath(exeDir, systemDir string) (string, error) {
	sl.logger.Println("Waiting for installation path choice from GUI...")
	
	// Signal frontend to show install dialog
	sl.sendInstallPrompt(exeDir, systemDir)
	
	// Wait for choice from GUI
	select {
	case choice := <-sl.installChoiceChan:
		switch choice {
		case "portable":
			// Create portable.txt marker
			portableMarker := filepath.Join(exeDir, "portable.txt")
			if err := os.WriteFile(portableMarker, []byte("Portable installation marker"), 0644); err != nil {
				return "", fmt.Errorf("Konnte portable.txt nicht erstellen: %v", err)
			}
			sl.logger.Println("Portable mode selected")
			return exeDir, nil
		case "system":
			sl.logger.Println("System installation selected")
			return systemDir, nil
		default:
			// Default to system installation
			sl.logger.Println("Invalid choice, defaulting to system installation")
			return systemDir, nil
		}
	case <-time.After(5 * time.Minute):
		// Timeout after 5 minutes - default to system installation
		sl.logger.Println("Installation path choice timed out, defaulting to system installation")
		return systemDir, nil
	}
}

// loadVersionInfo loads version information from version.json
func (sl *StandaloneLauncher) loadVersionInfo() (*VersionInfo, error) {
	versionFile := filepath.Join(sl.baseDir, "version.json")
	
	data, err := os.ReadFile(versionFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // No version file - first installation
		}
		return nil, err
	}
	
	var versionInfo VersionInfo
	if err := json.Unmarshal(data, &versionInfo); err != nil {
		return nil, err
	}
	
	return &versionInfo, nil
}

// saveVersionInfo saves version information to version.json
func (sl *StandaloneLauncher) saveVersionInfo(version string) error {
	versionInfo := VersionInfo{
		Version:       version,
		InstalledDate: time.Now().Format(time.RFC3339),
		LastChecked:   time.Now().Format(time.RFC3339),
	}
	
	data, err := json.MarshalIndent(versionInfo, "", "  ")
	if err != nil {
		return err
	}
	
	versionFile := filepath.Join(sl.baseDir, "version.json")
	return os.WriteFile(versionFile, data, 0644)
}

// loadSettings loads launcher settings from launcher-settings.json
func (sl *StandaloneLauncher) loadSettings() (*Settings, error) {
	settingsFile := filepath.Join(sl.baseDir, "launcher-settings.json")
	
	data, err := os.ReadFile(settingsFile)
	if err != nil {
		if os.IsNotExist(err) {
			// Return default settings
			return &Settings{AutoUpdate: true}, nil
		}
		return nil, err
	}
	
	var settings Settings
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}
	
	return &settings, nil
}

// saveSettings saves launcher settings to launcher-settings.json
func (sl *StandaloneLauncher) saveSettings(settings *Settings) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	
	settingsFile := filepath.Join(sl.baseDir, "launcher-settings.json")
	return os.WriteFile(settingsFile, data, 0644)
}

// loadProfiles loads profile configuration from profiles.json
func (sl *StandaloneLauncher) loadProfiles() (*ProfilesConfig, error) {
	profilesFile := filepath.Join(sl.baseDir, "profiles.json")
	
	data, err := os.ReadFile(profilesFile)
	if err != nil {
		if os.IsNotExist(err) {
			// Return default profile config
			return &ProfilesConfig{
				Active: "default",
				Profiles: []Profile{
					{ID: "default", Name: "Standard-Profil", TikTokUsername: ""},
				},
			}, nil
		}
		return nil, err
	}
	
	var profiles ProfilesConfig
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, err
	}
	
	return &profiles, nil
}

// saveProfiles saves profile configuration to profiles.json
func (sl *StandaloneLauncher) saveProfiles(profiles *ProfilesConfig) error {
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return err
	}
	
	profilesFile := filepath.Join(sl.baseDir, "profiles.json")
	return os.WriteFile(profilesFile, data, 0644)
}

// compareVersions compares two semantic version strings
// Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
func compareVersions(v1, v2 string) int {
	// Remove 'v' prefix if present
	v1 = strings.TrimPrefix(v1, "v")
	v2 = strings.TrimPrefix(v2, "v")
	
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")
	
	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}
	
	for i := 0; i < maxLen; i++ {
		var n1, n2 int
		
		if i < len(parts1) {
			fmt.Sscanf(parts1[i], "%d", &n1)
		}
		if i < len(parts2) {
			fmt.Sscanf(parts2[i], "%d", &n2)
		}
		
		if n1 < n2 {
			return -1
		}
		if n1 > n2 {
			return 1
		}
	}
	
	return 0
}

// checkForUpdates checks if a newer version is available
func (sl *StandaloneLauncher) checkForUpdates() (*GitHubRelease, bool, error) {
	sl.logger.Println("Checking for updates...")
	
	// Load installed version
	versionInfo, err := sl.loadVersionInfo()
	if err != nil {
		sl.logger.Printf("Error loading version info: %v\n", err)
	}
	
	installedVersion := ""
	if versionInfo != nil {
		installedVersion = versionInfo.Version
	}
	
	// Get latest release from GitHub
	release, err := sl.getLatestRelease()
	if err != nil {
		return nil, false, fmt.Errorf("Konnte Update-Info nicht abrufen: %v", err)
	}
	
	if release == nil {
		// No release available
		sl.logger.Println("No GitHub release available")
		return nil, false, nil
	}
	
	releaseVersion := strings.TrimPrefix(release.TagName, "v")
	sl.logger.Printf("Current launcher version: %s\n", launcherVersion)
	sl.logger.Printf("Installed app version: %s\n", installedVersion)
	sl.logger.Printf("Latest release version: %s\n", releaseVersion)
	
	// Check if update is available (compare with installed version if exists, otherwise with launcher version)
	compareWith := installedVersion
	if compareWith == "" {
		compareWith = launcherVersion
	}
	
	updateAvailable := compareVersions(compareWith, releaseVersion) < 0
	
	return release, updateAvailable, nil
}

// waitForUpdateDecision waits for user to confirm update via GUI
func (sl *StandaloneLauncher) waitForUpdateDecision() bool {
	sl.logger.Println("Waiting for update decision from GUI...")
	
	// Signal frontend to show update dialog
	sl.sendUpdatePrompt()
	
	// Wait for choice from GUI
	select {
	case accept := <-sl.updateChoiceChan:
		if accept {
			sl.logger.Println("User accepted update")
			return true
		}
		sl.logger.Println("User skipped update")
		return false
	case <-time.After(5 * time.Minute):
		// Timeout after 5 minutes - skip update
		sl.logger.Println("Update decision timed out, skipping update")
		return false
	}
}

func (sl *StandaloneLauncher) run() error {
	// Start HTTP server FIRST (before any prompts)
	http.HandleFunc("/", sl.serveSplash)
	http.HandleFunc("/events", sl.handleSSE)
	http.HandleFunc("/api/install-prompt", sl.handleInstallPrompt)
	http.HandleFunc("/api/update-prompt", sl.handleUpdatePrompt)
	http.HandleFunc("/api/release", sl.handleGetRelease)
	http.HandleFunc("/api/settings", sl.handleSettings)
	http.HandleFunc("/api/profiles", sl.handleProfiles)
	http.HandleFunc("/api/check-update", sl.handleCheckUpdate)
	
	go func() {
		sl.logger.Println("Starting web server on :8765")
		if err := http.ListenAndServe(":8765", nil); err != nil {
			sl.logger.Printf("HTTP server error: %v\n", err)
		}
	}()
	
	// Wait a moment for server to start
	time.Sleep(500 * time.Millisecond)
	
	// Open browser to splash screen
	err := browser.OpenURL("http://localhost:8765")
	if err != nil {
		sl.logger.Printf("Failed to open browser: %v\n", err)
	}
	
	// Determine installation directory (this may wait for GUI input on first run)
	baseDir, err := sl.getInstallDir()
	if err != nil {
		return err
	}
	
	sl.baseDir = baseDir
	sl.logger.Printf("Installation directory: %s\n", sl.baseDir)
	
	// Load settings
	settings, err := sl.loadSettings()
	if err != nil {
		sl.logger.Printf("Warning: Could not load settings: %v\n", err)
		settings = &Settings{AutoUpdate: true}
	}
	sl.settings = settings
	
	// Check for updates
	release, updateAvailable, err := sl.checkForUpdates()
	if err != nil {
		sl.logger.Printf("Warning: Could not check for updates: %v\n", err)
		// Continue anyway - don't block installation
	} else if updateAvailable && release != nil {
		sl.pendingRelease = release
		
		// Check auto-update setting
		if sl.settings.AutoUpdate {
			sl.logger.Println("Auto-update enabled, updating automatically...")
			sl.skipUpdate = false
		} else {
			// Wait for user decision via GUI
			if sl.waitForUpdateDecision() {
				sl.skipUpdate = false
			} else {
				sl.skipUpdate = true
			}
		}
	}
	
	// Download repository (only if not skipping update or first install)
	if !sl.skipUpdate {
		if err := sl.downloadRepository(); err != nil {
			sl.sendError(err.Error())
			return err
		}

		// Save version info after successful download
		versionToSave := launcherVersion
		if sl.pendingRelease != nil {
			versionToSave = strings.TrimPrefix(sl.pendingRelease.TagName, "v")
		}
		if err := sl.saveVersionInfo(versionToSave); err != nil {
			sl.logger.Printf("Warning: Could not save version info: %v\n", err)
		}
	} else {
		sl.updateProgress(70, "Überspringe Download, verwende vorhandene Installation...")
	}

	// Check Node.js
	nodePath, err := sl.checkNodeJS()
	if err != nil {
		sl.sendError(err.Error())
		return err
	}

	// Check if prebuilt bundle with dependencies was extracted (skip npm install if so)
	appDir := filepath.Join(sl.baseDir, "app")
	betterSqlitePath := filepath.Join(appDir, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node")
	hasPrebuiltDeps := false
	if _, statErr := os.Stat(betterSqlitePath); statErr == nil {
		hasPrebuiltDeps = true
		sl.logger.Println("✅ Prebuilt bundle detected (better_sqlite3.node found), skipping npm install")
	}

	// Run pre-flight checks and install dependencies only if no prebuilt bundle
	if !sl.skipUpdate && !hasPrebuiltDeps {
		results, allPassed := sl.runPreflightChecks(nodePath)
		if !allPassed {
			sl.logger.Println("⚠️ Pre-flight checks failed - some dependencies are missing")
			for _, result := range results {
				if !result.Found && result.Required {
					sl.logger.Printf("   ❌ Missing: %s - %s\n", result.Name, result.InstallHint)
				}
			}

			// Give user 30 seconds to read the warnings and potentially install missing deps
			sl.updateProgress(73, "⚠️ Fehlende Abhängigkeiten erkannt - prüfe Details oben. Versuche trotzdem npm install in 30s...")
			time.Sleep(30 * time.Second)
		} else {
			sl.logger.Println("✅ All pre-flight checks passed!")
		}

		if err := sl.installDependencies(appDir); err != nil {
			sl.sendError(err.Error())
			return err
		}
	} else if hasPrebuiltDeps {
		sl.updateProgress(90, "✅ Abhängigkeiten aus Prebuilt-Bundle geladen!")
	} else {
		sl.updateProgress(90, "Überspringe Abhängigkeiten-Installation...")
	}

	// Start application
	return sl.startApplication(nodePath, appDir)
}

func main() {
	sl := NewStandaloneLauncher()
	
	if err := sl.run(); err != nil {
		sl.logger.Printf("❌ FEHLER: %v\n", err)
		os.Exit(1)
	}
}
