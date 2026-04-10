package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/pkg/browser"
)

const (
	// CREATE_NO_WINDOW flag for Windows to hide console window
	createNoWindow = 0x08000000
	maxLogBytes    = 100000
)

type Launcher struct {
	nodePath        string
	appDir          string
	exeDir          string
	configDir       string
	userConfigsDir  string
	progress        int
	status          string
	statusKey       string
	statusFallback  string
	statusArgs      []interface{}
	clients         map[chan string]bool
	clientsMu       sync.Mutex // Schützt concurrent map access auf clients
	logFile         *os.File
	logger          *log.Logger
	envFileFixed    bool // Track if we auto-created .env file
	alternativePort int  // Alternative port when 3000 is in use
	serverPort      int  // Actual port the server responded on
	profiles        []ProfileInfo
	profilesLoaded  time.Time // Last time profiles were loaded
	selectedProfile string
	locale          string
	translations    map[string]interface{}
	nodeCmd         *exec.Cmd  // Referenz auf laufenden Node-Prozess
	nodeMu          sync.Mutex // Schützt nodeCmd-Zugriff
}

var allowedLocales = []string{"de", "en", "es", "fr"}

type ProfileInfo struct {
	Username string    `json:"username"`
	Modified time.Time `json:"modified"`
}

func NewLauncher() *Launcher {
	return &Launcher{
		status:          "Initialisiere...",
		progress:        0,
		clients:         make(map[chan string]bool),
		envFileFixed:    false,
		locale:          "de", // Default to German
		selectedProfile: "",
		profiles:        []ProfileInfo{},
	}
}

// loadTranslations loads i18n strings from locale files
func (l *Launcher) loadTranslations(locale string) error {
	// Try build-src/locales first (for development), then locales (for installed version)
	localesDir := filepath.Join(l.exeDir, "build-src", "locales")
	localePath := filepath.Join(localesDir, locale+".json")
	
	// If build-src/locales doesn't exist, try the locales directory directly (installed version)
	if _, err := os.Stat(localesDir); os.IsNotExist(err) {
		localesDir = filepath.Join(l.exeDir, "locales")
		localePath = filepath.Join(localesDir, locale+".json")
	}

	// Fallback to de.json if file not found
	if _, err := os.Stat(localePath); os.IsNotExist(err) {
		localePath = filepath.Join(localesDir, "de.json")
	}

	data, err := os.ReadFile(localePath)
	if err != nil {
		if l.logger != nil {
			l.logger.Printf("[WARNING] Could not load translations from %s: %v\n", localePath, err)
		}
		return nil
	}

	err = json.Unmarshal(data, &l.translations)
	if err != nil {
		if l.logger != nil {
			l.logger.Printf("[ERROR] Could not parse translations: %v\n", err)
		}
		return err
	}

	if l.logger != nil {
		l.logger.Printf("[INFO] Loaded translations for locale: %s\n", locale)
	}
	return nil
}

// getTranslation retrieves a translation by key path (e.g., "status.initializing")
func (l *Launcher) getTranslation(key string) string {
	if l.translations == nil {
		return key
	}

	parts := strings.Split(key, ".")
	current := l.translations

	for i, part := range parts {
		if val, ok := current[part]; ok {
			if i == len(parts)-1 {
				if str, ok := val.(string); ok {
					return str
				}
			} else if nested, ok := val.(map[string]interface{}); ok {
				current = nested
			}
		}
	}

	return key
}

func (l *Launcher) getTranslationWithFallback(key string, fallback string) string {
	translated := l.getTranslation(key)
	if translated == "" || translated == key {
		return fallback
	}
	return translated
}

func (l *Launcher) translateStatus(key string, fallback string, args ...interface{}) string {
	text := fallback
	if key != "" {
		text = l.getTranslationWithFallback(key, fallback)
	}
	if len(args) > 0 {
		return fmt.Sprintf(text, args...)
	}
	return text
}

func (l *Launcher) currentStatus() string {
	if l.statusKey != "" {
		return l.translateStatus(l.statusKey, l.statusFallback, l.statusArgs...)
	}
	return l.status
}

// truncateLogData keeps the most recent portion of log data up to maxBytes.
// It attempts to start from the next newline after the truncation point to
// avoid presenting partial log lines where possible.
func truncateLogData(data []byte, maxBytes int) []byte {
	if len(data) <= maxBytes {
		return data
	}

	start := len(data) - maxBytes
	if idx := bytes.IndexByte(data[start:], '\n'); idx >= 0 && start+idx+1 <= len(data) {
		return data[start+idx+1:]
	}

	return data[start:]
}

// getDefaultConfigDir mirrors the app's ConfigPathManager default paths
func (l *Launcher) getDefaultConfigDir() string {
	homeDir, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData == "" {
			localAppData = filepath.Join(homeDir, "AppData", "Local")
		}
		return filepath.Join(localAppData, "pupcidslittletiktokhelper")
	case "darwin":
		return filepath.Join(homeDir, "Library", "Application Support", "pupcidslittletiktokhelper")
	default:
		return filepath.Join(homeDir, ".local", "share", "pupcidslittletiktokhelper")
	}
}

// initConfigPaths resolves the persistent config directory and user_configs path
func (l *Launcher) initConfigPaths() {
	l.configDir = l.getDefaultConfigDir()

	// Check for custom config path in .config_path (same behavior as ConfigPathManager)
	customPathFile := filepath.Join(l.appDir, ".config_path")
	if data, err := os.ReadFile(customPathFile); err == nil {
		candidate := strings.TrimSpace(string(data))
		if candidate != "" {
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				testFile := filepath.Join(candidate, ".write_test")
				if err := os.WriteFile(testFile, []byte("test"), 0644); err == nil {
					os.Remove(testFile)
					l.configDir = candidate
					if l.logger != nil {
						l.logger.Printf("[INFO] Using custom config path from .config_path: %s\n", candidate)
					}
				} else if l.logger != nil {
					l.logger.Printf("[WARNING] Custom config path not writable, using default: %v\n", err)
				}
			} else if l.logger != nil {
				l.logger.Printf("[WARNING] Custom config path invalid, using default: %v\n", err)
			}
		}
	}

	l.userConfigsDir = filepath.Join(l.configDir, "user_configs")

	if err := os.MkdirAll(l.userConfigsDir, 0755); err != nil && l.logger != nil {
		l.logger.Printf("[WARNING] Could not create user_configs dir %s: %v\n", l.userConfigsDir, err)
	}
}

func (l *Launcher) readProfilesFromDir(dir string) []ProfileInfo {
	if dir == "" {
		return []ProfileInfo{}
	}

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return []ProfileInfo{}
	}

	files, err := os.ReadDir(dir)
	if err != nil {
		if l.logger != nil {
			l.logger.Printf("[ERROR] Could not read user_configs at %s: %v\n", dir, err)
		}
		return []ProfileInfo{}
	}

	profiles := []ProfileInfo{}
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".db") {
			continue
		}

		username := strings.TrimSuffix(file.Name(), ".db")
		info, err := file.Info()
		if err != nil {
			continue
		}

		profiles = append(profiles, ProfileInfo{
			Username: username,
			Modified: info.ModTime(),
		})
	}

	return profiles
}

func (l *Launcher) findLatestServerLog() string {
	logDir := filepath.Join(l.appDir, "logs")
	entries, err := os.ReadDir(logDir)
	if err != nil {
		return ""
	}

	var latestPath string
	var latestTime time.Time

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}

		// Skip launcher logs to avoid duplication
		if strings.HasPrefix(entry.Name(), "launcher_") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		if latestPath == "" || info.ModTime().After(latestTime) {
			latestTime = info.ModTime()
			latestPath = filepath.Join(logDir, entry.Name())
		}
	}

	return latestPath
}

func (l *Launcher) readLogContent(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	data = truncateLogData(data, maxLogBytes)
	return string(data), nil
}

// loadUserProfiles scans for user profiles in user_configs directory
func (l *Launcher) loadUserProfiles() {
	primaryProfiles := l.readProfilesFromDir(l.userConfigsDir)

	// Fallback to app directory (legacy location) if none found in persistent storage
	if len(primaryProfiles) == 0 {
		legacyDir := filepath.Join(l.appDir, "user_configs")
		primaryProfiles = l.readProfilesFromDir(legacyDir)
		if len(primaryProfiles) > 0 && l.logger != nil {
			l.logger.Printf("[INFO] Found %d user profile(s) in legacy app directory\n", len(primaryProfiles))
		}
	}

	l.profiles = primaryProfiles
	l.profilesLoaded = time.Now()
	if l.logger != nil {
		l.logger.Printf("[INFO] Found %d user profile(s)\n", len(primaryProfiles))
	}
}

// setupLogging creates a log file in the app directory
func (l *Launcher) setupLogging(appDir string) error {
	logDir := filepath.Join(appDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %v", err)
	}

	timestamp := time.Now().Format("2006-01-02_15-04-05")
	logPath := filepath.Join(logDir, fmt.Sprintf("launcher_%s.log", timestamp))

	// Open with sync flag to ensure writes are flushed immediately
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND|os.O_SYNC, 0644)
	if err != nil {
		return fmt.Errorf("failed to create log file: %v", err)
	}

	l.logFile = logFile

	// Only write to file (not stdout) because in GUI mode stdout doesn't exist
	// This prevents silent failures when built with -H windowsgui
	l.logger = log.New(logFile, "", log.LstdFlags)

	l.logger.Println("========================================")
	l.logger.Println("TikTok Stream Tool - Launcher Log")
	l.logger.Println("========================================")
	l.logger.Printf("Log file: %s\n", logPath)
	l.logger.Printf("Platform: %s\n", runtime.GOOS)
	l.logger.Printf("Architecture: %s\n", runtime.GOARCH)
	l.logger.Println("========================================")

	// Force sync to ensure header is written
	if err := logFile.Sync(); err != nil {
		return fmt.Errorf("failed to sync log file: %v", err)
	}

	return nil
}

// closeLogging closes the log file
func (l *Launcher) closeLogging() {
	if l.logFile != nil {
		l.logger.Println("========================================")
		l.logger.Println("Launcher finished")
		l.logger.Println("========================================")
		l.logFile.Sync() // Ensure all writes are flushed
		l.logFile.Close()
	}
}

// logAndSync logs a message and immediately syncs to disk
// This ensures logs are written even if the process crashes
func (l *Launcher) logAndSync(format string, args ...interface{}) {
	if l.logger != nil {
		if len(args) > 0 {
			l.logger.Printf(format, args...)
		} else {
			l.logger.Println(format)
		}
		if l.logFile != nil {
			l.logFile.Sync()
		}
	}
}

func (l *Launcher) updateProgressRaw(value int, status string) {
	l.progress = value
	l.status = status

	msg := fmt.Sprintf(`{"progress": %d, "status": "%s"}`, value, status)
	l.clientsMu.Lock()
	for client := range l.clients {
		select {
		case client <- msg:
		default:
		}
	}
	l.clientsMu.Unlock()
}

func (l *Launcher) updateProgress(value int, status string) {
	l.statusKey = ""
	l.statusArgs = nil
	l.statusFallback = ""
	l.updateProgressRaw(value, status)
}

func (l *Launcher) updateProgressLocalized(value int, key string, fallback string, args ...interface{}) {
	l.statusKey = key
	l.statusFallback = fallback
	l.statusArgs = args
	statusText := l.translateStatus(key, fallback, args...)
	l.updateProgressRaw(value, statusText)
}

func (l *Launcher) sendRedirect() {
	port := l.serverPort
	if port == 0 {
		port = 3000
	}
	msg := fmt.Sprintf(`{"redirect": "http://localhost:%d/dashboard.html", "serverReady": true}`, port)
	l.clientsMu.Lock()
	for client := range l.clients {
		select {
		case client <- msg:
		default:
		}
	}
	l.clientsMu.Unlock()
}

func (l *Launcher) checkNodeJS() error {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return fmt.Errorf("Node.js ist nicht installiert")
	}
	l.nodePath = nodePath
	return nil
}

func (l *Launcher) getNodeVersion() string {
	cmd := exec.Command(l.nodePath, "--version")
	output, err := cmd.Output()
	if err != nil {
		return "unknown"
	}
	return string(output)
}

func (l *Launcher) checkNodeModules() bool {
	nodeModulesPath := filepath.Join(l.appDir, "node_modules")
	info, err := os.Stat(nodeModulesPath)
	if err != nil {
		return false
	}
	return info.IsDir()
}

func (l *Launcher) installDependencies() error {
	l.logger.Println("[INFO] Starting npm install...")
	l.updateProgressLocalized(45, "status.npm_install_start", "npm install wird gestartet...")
	time.Sleep(500 * time.Millisecond)

	// Show initial warning about potential delay
	l.updateProgressLocalized(45, "status.npm_install_delay_notice", "HINWEIS: npm install kann mehrere Minuten dauern, besonders bei langsamer Internetverbindung. Bitte warten...")
	time.Sleep(2 * time.Second)

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/C", "npm", "install", "--cache", "false")
		// Hide the npm install window on Windows using CREATE_NO_WINDOW flag
		cmd.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: createNoWindow,
		}
	} else {
		cmd = exec.Command("npm", "install", "--cache", "false")
	}

	cmd.Dir = l.appDir

	// Set environment variables to skip problematic preinstall checks
	cmd.Env = append(os.Environ(),
		"YOUTUBE_DL_SKIP_PYTHON_CHECK=1",
		"PUPPETEER_SKIP_DOWNLOAD=true",
	)

	// Capture output for logging and progress updates
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("Failed to create stdout pipe: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("Failed to create stderr pipe: %v", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		l.logger.Printf("[ERROR] Failed to start npm install: %v\n", err)
		return fmt.Errorf("Failed to start npm install: %v", err)
	}

	// Track progress with live updates
	progressCounter := 0
	maxProgress := 75
	lastUpdate := time.Now()
	installComplete := false

	// Heartbeat ticker to show activity even when npm produces no output
	heartbeatTicker := time.NewTicker(3 * time.Second)
	defer heartbeatTicker.Stop()

	// Channel to signal when stdout reading is done
	stdoutDone := make(chan bool)

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			l.logger.Printf("[npm stdout] %s\n", line)
			// Show progress in UI with incremental progress bar
			if len(line) > 0 {
				// Increment progress from 45 to 75 during npm install
				progressCounter++
				currentProgress := 45 + (progressCounter / 2)
				if currentProgress > maxProgress {
					currentProgress = maxProgress
				}

				// Don't truncate - show full line for better visibility
				displayLine := line
				if len(displayLine) > 120 {
					displayLine = displayLine[:117] + "..."
				}
				l.updateProgressLocalized(currentProgress, "status.npm_install_line", "npm install: %s", displayLine)
				lastUpdate = time.Now()
			}
		}
		stdoutDone <- true
	}()

	// Log errors and collect stderr output for fallback error reporting
	var stderrBuf bytes.Buffer
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			l.logger.Printf("[npm stderr] %s\n", line)
			stderrBuf.WriteString(line + "\n")
		}
	}()

	// Heartbeat goroutine to show activity
	go func() {
		for !installComplete {
			select {
			case <-heartbeatTicker.C:
				// If no output for more than 3 seconds, show activity indicator
				if time.Since(lastUpdate) >= 3*time.Second {
					elapsed := int(time.Since(lastUpdate).Seconds())
					currentProgress := 45 + (progressCounter / 2)
					if currentProgress > maxProgress {
						currentProgress = maxProgress
					}
					if currentProgress < 50 {
						currentProgress = 50 // Show at least 50% during install
					}
					l.updateProgressLocalized(currentProgress, "status.npm_install_running", "npm install läuft... (%ds) - Bitte warten, Downloads können mehrere Minuten dauern", elapsed)
				}
			}
		}
	}()

	// Wait for command to complete
	err = cmd.Wait()
	installComplete = true

	// Wait for stdout processing to complete
	<-stdoutDone

	if err != nil {
		stderrOutput := stderrBuf.String()
		l.logger.Printf("[ERROR] npm install (with --cache false) failed: %v\n", err)
		if stderrOutput != "" {
			l.logger.Printf("[ERROR] npm stderr output: %s\n", stderrOutput)
		}

		// Fallback: retry without --cache flag
		l.logger.Println("[INFO] Retrying npm install without --cache flag...")
		l.updateProgressLocalized(50, "status.npm_install_retry", "Wiederhole npm install (Fallback ohne --cache)...")
		time.Sleep(1 * time.Second)

		var retryCmd *exec.Cmd
		if runtime.GOOS == "windows" {
			retryCmd = exec.Command("cmd", "/C", "npm", "install")
			retryCmd.SysProcAttr = &syscall.SysProcAttr{
				CreationFlags: createNoWindow,
			}
		} else {
			retryCmd = exec.Command("npm", "install")
		}
		retryCmd.Dir = l.appDir
		retryCmd.Env = append(os.Environ(),
			"YOUTUBE_DL_SKIP_PYTHON_CHECK=1",
			"PUPPETEER_SKIP_DOWNLOAD=true",
		)
		var retryStderr bytes.Buffer
		retryCmd.Stderr = &retryStderr

		if retryErr := retryCmd.Run(); retryErr != nil {
			if retryStderr.Len() > 0 {
				l.logger.Printf("[ERROR] npm install retry stderr: %s\n", retryStderr.String())
			}
			l.logger.Printf("[ERROR] npm install retry also failed: %v\n", retryErr)
			return fmt.Errorf("Installation fehlgeschlagen: %v", retryErr)
		}

		l.logger.Println("[SUCCESS] npm install retry (without --cache) succeeded")
	}

	l.logger.Println("[SUCCESS] npm install completed successfully")
	return nil
}

func (l *Launcher) startTool() (*exec.Cmd, error) {
	launchJS := filepath.Join(l.appDir, "launch.js")
	cmd := exec.Command(l.nodePath, launchJS)
	cmd.Dir = l.appDir

	// Set environment variable to disable automatic browser opening
	// The GUI launcher handles the redirect to dashboard after server is ready
	// Build environment explicitly to ensure OPEN_BROWSER is properly set
	env := []string{}
	for _, e := range os.Environ() {
		// Skip any existing OPEN_BROWSER variable to avoid conflicts
		if strings.HasPrefix(e, "OPEN_BROWSER=") {
			continue
		}
		// Strip existing PORT to avoid conflicts when we set our own
		if l.alternativePort > 0 && strings.HasPrefix(e, "PORT=") {
			continue
		}
		env = append(env, e)
	}
	env = append(env, "OPEN_BROWSER=false")
	// Pass alternative port via PORT env var so the server binds to the right port
	if l.alternativePort > 0 {
		env = append(env, fmt.Sprintf("PORT=%d", l.alternativePort))
		l.logAndSync("PORT environment variable set to: %d", l.alternativePort)
	}
	cmd.Env = env

	// Redirect both stdout and stderr to log file only (not os.Stdout because GUI mode has no console)
	if l.logFile != nil {
		cmd.Stdout = l.logFile
		cmd.Stderr = l.logFile
	}
	// Note: We don't redirect stdin in GUI mode as there's no console

	l.logAndSync("Starting Node.js server...")
	l.logAndSync("Command: %s %s", l.nodePath, launchJS)
	l.logAndSync("Working directory: %s", l.appDir)
	l.logAndSync("OPEN_BROWSER environment variable set to: false")
	l.logAndSync("--- Node.js Server Output Start ---")

	setSysProcAttr(cmd)

	err := cmd.Start()
	if err != nil {
		return nil, err
	}

	l.nodeMu.Lock()
	l.nodeCmd = cmd
	l.nodeMu.Unlock()

	return cmd, nil
}

// killNodeProcess beendet den Node-Child-Prozess sauber.
// Auf Windows: taskkill /T um auch Child-Prozesse von Node zu beenden.
// Auf Unix: SIGTERM an die Prozessgruppe, dann SIGKILL-Fallback nach 3s.
func (l *Launcher) killNodeProcess() {
	l.nodeMu.Lock()
	cmd := l.nodeCmd
	l.nodeMu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return
	}

	pid := cmd.Process.Pid
	if l.logger != nil {
		l.logger.Printf("[INFO] Terminating Node.js process (PID: %d)...\n", pid)
	}

	killNodeProcessOS(cmd, pid)

	l.nodeMu.Lock()
	l.nodeCmd = nil
	l.nodeMu.Unlock()

	if l.logger != nil {
		l.logger.Printf("[INFO] Node.js process (PID: %d) terminated.\n", pid)
	}
}

// checkServerHealth checks if the server is responding
func (l *Launcher) checkServerHealth() bool {
	return l.checkServerHealthOnPort(3000)
}

// checkServerHealthOnPort checks if the server is responding on a specific port
func (l *Launcher) checkServerHealthOnPort(port int) bool {
	client := &http.Client{
		Timeout: 2 * time.Second,
	}

	url := fmt.Sprintf("http://localhost:%d/dashboard.html", port)
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == 200
}

// waitForServer waits for the server to be ready or timeout
func (l *Launcher) waitForServer(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		if l.checkServerHealth() {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	return fmt.Errorf("Server did not start within %v", timeout)
}

// autoFixEnvFile checks if .env exists and creates it from .env.example if missing
func (l *Launcher) autoFixEnvFile() error {
	envPath := filepath.Join(l.appDir, ".env")
	envExamplePath := filepath.Join(l.appDir, ".env.example")

	// Check if .env already exists
	if _, err := os.Stat(envPath); err == nil {
		l.logger.Println("[INFO] .env file already exists")
		return nil
	}

	// Check if .env.example exists
	if _, err := os.Stat(envExamplePath); os.IsNotExist(err) {
		l.logger.Println("[WARNING] .env.example not found, cannot auto-create .env")
		return fmt.Errorf(".env.example not found")
	}

	l.logger.Println("[AUTO-FIX] Creating .env from .env.example...")
	l.updateProgressLocalized(85, "status.env_creating", "🔧 Auto-Fix: Erstelle .env Datei...")

	// Read .env.example
	input, err := os.ReadFile(envExamplePath)
	if err != nil {
		l.logger.Printf("[ERROR] Failed to read .env.example: %v\n", err)
		return err
	}

	// Write to .env
	err = os.WriteFile(envPath, input, 0644)
	if err != nil {
		l.logger.Printf("[ERROR] Failed to write .env: %v\n", err)
		return err
	}

	l.logger.Println("[SUCCESS] .env file created successfully")
	l.updateProgressLocalized(86, "status.env_created", "✅ .env Datei erstellt!")
	l.envFileFixed = true // Mark that we fixed the .env file
	time.Sleep(1 * time.Second)

	return nil
}

// checkPortAvailable checks if a port is available
func (l *Launcher) checkPortAvailable(port int) bool {
	address := fmt.Sprintf("localhost:%d", port)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return false
	}
	listener.Close()
	return true
}

// autoFixYtDlp checks if yt-dlp is available and logs a warning if it is missing
func (l *Launcher) autoFixYtDlp() {
	l.logger.Println("[INFO] Checking yt-dlp availability...")

	// Check if the npm-bundled binary from youtube-dl-exec exists.
	// The youtube-dl-exec package (added as an npm dependency) downloads the yt-dlp binary
	// into its own bin/ directory during postinstall. Path: node_modules/youtube-dl-exec/bin/yt-dlp(.exe)
	npmBinaryName := "yt-dlp"
	if runtime.GOOS == "windows" {
		npmBinaryName = "yt-dlp.exe"
	}
	npmBinaryPath := filepath.Join(l.appDir, "node_modules", "youtube-dl-exec", "bin", npmBinaryName)
	if _, err := os.Stat(npmBinaryPath); err == nil {
		l.logger.Printf("[INFO] yt-dlp npm-bundled binary found: %s\n", npmBinaryPath)
		return
	}

	// Check if yt-dlp is already available in system PATH
	for _, ytdlpCmd := range []string{"yt-dlp", "yt_dlp"} {
		cmd := exec.Command(ytdlpCmd, "--version")
		if output, err := cmd.CombinedOutput(); err == nil {
			l.logger.Printf("[INFO] yt-dlp found in PATH: %s\n", strings.TrimSpace(string(output)))
			return
		}
	}

	l.logger.Println("[WARNING] yt-dlp not found. The Music Bot requires yt-dlp to function. " +
		"Run 'npm install' in the app directory to restore the bundled binary, " +
		"or set a custom path in Music Bot settings.")
}

// autoFixPort checks if port 3000 is available and logs status
func (l *Launcher) autoFixPort() {
	l.logger.Println("[INFO] Checking if port 3000 is available...")

	if l.checkPortAvailable(3000) {
		l.logger.Println("[SUCCESS] Port 3000 is available")
		return
	}

	l.logger.Println("[WARNING] Port 3000 is already in use")
	l.updateProgressLocalized(87, "status.port_in_use", "⚠️ Port 3000 belegt - prüfe ob Instanz läuft...")

	// Check if an LTTH server is actually responding on port 3000
	if l.checkServerHealthOnPort(3000) {
		l.logger.Println("[INFO] Server is already running on port 3000")
		l.updateProgressLocalized(88, "status.server_already_running", "ℹ️ Server läuft bereits auf Port 3000")
		time.Sleep(2 * time.Second)
		return
	}

	// Port is occupied but no server responds.
	// This usually means the OS is holding the port in TCP TIME_WAIT after a recent shutdown.
	// Wait up to 15 seconds for the port to be released before falling back to an alternative.
	l.logger.Println("[INFO] Port in use but no server responding - waiting for port release (TIME_WAIT)...")
	l.updateProgressLocalized(87, "status.port_wait", "⏳ Warte auf Port-Freigabe nach Shutdown...")

	for i := 0; i < 15; i++ {
		time.Sleep(1 * time.Second)
		if l.checkPortAvailable(3000) {
			l.logger.Println("[SUCCESS] Port 3000 is now available after waiting")
			l.updateProgressLocalized(88, "status.port_freed", "✅ Port 3000 ist wieder frei")
			return
		}
		l.logger.Printf("[INFO] Waiting for port 3000... (%d/15s)\n", i+1)
	}

	// Still occupied after 15s → fall back to alternative port
	l.logger.Println("[WARNING] Port 3000 still in use after 15s, trying alternative ports...")
	time.Sleep(2 * time.Second)

	for _, altPort := range []int{3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009} {
		if l.checkPortAvailable(altPort) {
			l.alternativePort = altPort
			l.logger.Printf("[INFO] Alternative port %d selected for server\n", altPort)
			l.updateProgressLocalized(88, "status.port_alternative_found", "ℹ️ Alternativer Port %d wird genutzt", altPort)
			time.Sleep(1 * time.Second)
			return
		}
	}

	l.logger.Println("[WARNING] No alternative port found in range 3001-3009")
}

func (l *Launcher) runLauncher() {
	time.Sleep(1 * time.Second) // Give browser time to load

	// Phase 1: Check Node.js (0-20%)
	l.updateProgressLocalized(0, "status.checking_nodejs", "Prüfe Node.js Installation...")
	l.logAndSync("[Phase 1] Checking Node.js installation...")
	time.Sleep(500 * time.Millisecond)

	err := l.checkNodeJS()
	if err != nil {
		l.logAndSync("[ERROR] Node.js check failed: %v", err)
		l.updateProgressLocalized(0, "status.nodejs_missing", "FEHLER: Node.js ist nicht installiert!")
		time.Sleep(5 * time.Second)
		l.closeLogging()
		os.Exit(1)
	}

	l.updateProgressLocalized(10, "status.nodejs_found", "Node.js gefunden...")
	l.logAndSync("[SUCCESS] Node.js found at: %s", l.nodePath)
	time.Sleep(300 * time.Millisecond)

	version := l.getNodeVersion()
	l.updateProgressLocalized(20, "status.nodejs_version", "Node.js Version: %s", version)
	l.logger.Printf("[INFO] Node.js version: %s\n", version)
	time.Sleep(300 * time.Millisecond)

	// Phase 2: Find directories (20-30%)
	l.updateProgressLocalized(25, "status.checking_app_dir", "Prüfe App-Verzeichnis...")
	l.logger.Printf("[Phase 2] Checking app directory: %s\n", l.appDir)
	time.Sleep(300 * time.Millisecond)

	if _, err := os.Stat(l.appDir); os.IsNotExist(err) {
		l.logger.Printf("[ERROR] App directory not found: %s\n", l.appDir)
		l.updateProgressLocalized(25, "status.app_dir_missing", "FEHLER: app Verzeichnis nicht gefunden")
		time.Sleep(5 * time.Second)
		l.closeLogging()
		os.Exit(1)
	}

	l.updateProgressLocalized(30, "status.app_dir_found", "App-Verzeichnis gefunden...")
	l.logger.Printf("[SUCCESS] App directory exists: %s\n", l.appDir)
	time.Sleep(300 * time.Millisecond)

	// Phase 3: Check and install dependencies (30-80%)
	l.updateProgressLocalized(30, "status.checking_dependencies", "Prüfe Abhängigkeiten...")
	l.logger.Println("[Phase 3] Checking dependencies...")
	time.Sleep(300 * time.Millisecond)

	if !l.checkNodeModules() {
		l.updateProgressLocalized(40, "status.installing_dependencies", "Installiere Abhängigkeiten...")
		l.logger.Println("[INFO] node_modules not found, installing dependencies...")
		time.Sleep(500 * time.Millisecond)
		l.updateProgressLocalized(45, "status.installation_hint", "HINWEIS: npm install kann einige Minuten dauern, bitte das Fenster offen halten und warten")

		err = l.installDependencies()
		if err != nil {
			l.logger.Printf("[ERROR] Dependency installation failed: %v\n", err)
			l.updateProgressLocalized(45, "status.installation_failed", "FEHLER: %v", err)
			time.Sleep(5 * time.Second)
			l.closeLogging()
			os.Exit(1)
		}

		l.updateProgressLocalized(80, "status.installation_done", "Installation abgeschlossen!")
		l.logger.Println("[SUCCESS] Dependencies installed successfully")
	} else {
		l.updateProgressLocalized(80, "status.dependencies_installed", "Abhängigkeiten bereits installiert...")
		l.logger.Println("[INFO] Dependencies already installed")
	}
	time.Sleep(300 * time.Millisecond)

	// Phase 3.5: Auto-fix common issues (80-89%)
	l.updateProgressLocalized(82, "status.checking_config", "Prüfe Konfiguration...")
	l.logger.Println("[Phase 3.5] Auto-fixing common issues...")
	time.Sleep(300 * time.Millisecond)

	// Auto-fix: Create .env file if missing
	if err := l.autoFixEnvFile(); err != nil {
		l.logger.Printf("[WARNING] Could not auto-create .env: %v\n", err)
	}

	// Auto-fix: Check port availability
	l.autoFixPort()

	// Auto-fix: Install yt-dlp if missing
	l.autoFixYtDlp()

	l.updateProgressLocalized(89, "status.config_ok", "Konfiguration geprüft!")
	time.Sleep(300 * time.Millisecond)

	// Phase 4: Start tool (90-100%)
	l.updateProgressLocalized(90, "status.starting_tool", "Starte Tool...")
	l.logger.Println("[Phase 4] Starting Node.js server...")
	time.Sleep(500 * time.Millisecond)

	// Start the tool
	cmd, err := l.startTool()
	if err != nil {
		l.logger.Printf("[ERROR] Failed to start server: %v\n", err)
		l.updateProgressLocalized(90, "status.start_error", "FEHLER beim Starten: %v", err)
		l.updateProgressLocalized(90, "status.check_logs", "Prüfe bitte die Log-Datei in app/logs/ für Details.")
		time.Sleep(30 * time.Second)
		l.closeLogging()
		os.Exit(1)
	}

	// Monitor if the process exits prematurely
	processDied := make(chan error, 1)
	go func() {
		processDied <- cmd.Wait()
	}()

	// Wait for server to be ready
	l.updateProgressLocalized(93, "status.waiting_for_server_start", "Warte auf Server-Start...")
	l.logger.Println("[INFO] Waiting for server health check (60s timeout)...")
	l.logger.Println("[INFO] Checking if server responds on http://localhost:3000...")

	// Check server health with process monitoring
	healthCheckTimeout := time.After(60 * time.Second)
	healthCheckTicker := time.NewTicker(1 * time.Second)
	defer healthCheckTicker.Stop()

	serverReady := false
	attemptCount := 0
	lastLogTime := time.Now()

	for !serverReady {
		select {
		case err := <-processDied:
			// Process exited before server was ready
			// Ensure log file is flushed to capture all server output
			if l.logFile != nil {
				l.logFile.Sync()
				time.Sleep(100 * time.Millisecond) // Give a moment for any buffered writes
			}

			l.logAndSync("--- Node.js Server Output End ---")
			l.logAndSync("[ERROR] ===========================================")
			l.logAndSync("[ERROR] Node.js process exited prematurely: %v", err)
			l.logAndSync("[ERROR] Server crashed during startup!")
			l.logAndSync("[ERROR] Check the server output above for the actual error")
			l.logAndSync("[ERROR] ===========================================")
			l.logAndSync("[ERROR] Häufige Ursachen:")
			l.logAndSync("[ERROR]  - Fehlende .env Datei (kopiere .env.example zu .env)")
			l.logAndSync("[ERROR]  - Port 3000 bereits belegt")
			l.logAndSync("[ERROR]  - Fehlende Dependencies (führe 'npm install' aus)")
			l.logAndSync("[ERROR]  - Syntax-Fehler im Code")
			l.logAndSync("[ERROR] ===========================================")

			// Check if we just fixed the .env file - if so, retry once
			if l.envFileFixed {
				l.logAndSync("[AUTO-FIX] .env file was just created - attempting restart...")
				l.updateProgressLocalized(95, "status.env_restart", "🔄 .env erstellt - starte Server neu...")
				time.Sleep(3 * time.Second)

				// Mark that we already tried the fix
				l.envFileFixed = false

				// Start server again
				cmd, err = l.startTool()
				if err != nil {
					l.logAndSync("[ERROR] Retry failed to start server: %v", err)
				} else {
					// Monitor the restarted process
					go func() {
						processDied <- cmd.Wait()
					}()

					l.updateProgressLocalized(96, "status.server_restart_wait", "🔄 Server neugestartet - warte auf Antwort...")
					l.logAndSync("[INFO] Server restarted after .env fix - waiting for health check...")

					// Reset the ticker for another try
					continue
				}
			}

			l.updateProgressLocalized(95, "status.server_failed_start", "⚠️ Server konnte nicht starten!")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(96, "status.auto_fixes_done", "📋 Alle Auto-Fixes wurden versucht")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(97, "status.check_launcher_logs", "💡 Prüfe app/logs/launcher_*.log für Details")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(98, "status.manual_install_hint", "💡 Oder führe manuell: cd app && npm install")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(99, "status.port_check_hint", "💡 Oder prüfe ob Port 3000 frei ist")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(100, "status.closing", "❌ Launcher wird in 15 Sekunden geschlossen...")
			time.Sleep(15 * time.Second)
			l.closeLogging()
			os.Exit(1)
		case <-healthCheckTicker.C:
			attemptCount++

			// Log progress every 5 seconds
			if time.Since(lastLogTime) >= 5*time.Second {
				l.logger.Printf("[INFO] Health check attempt %d (waiting for server to respond)...\n", attemptCount)
				l.updateProgressLocalized(93+(attemptCount/5), "status.waiting_attempt", "Warte auf Server... (Versuch %d)", attemptCount)
				lastLogTime = time.Now()
			}

			// Try multiple ports (server might have failed over)
			ports := []int{3000, 3001, 3002, 3003, 3004}
			for _, port := range ports {
				if l.checkServerHealthOnPort(port) {
					l.logger.Printf("[SUCCESS] Server responded on port %d!\n", port)
					if port != 3000 {
						l.logger.Printf("[INFO] Note: Server is running on port %d instead of 3000\n", port)
					}
					l.serverPort = port
					serverReady = true
					break
				}
			}
		case <-healthCheckTimeout:
			l.logger.Println("[ERROR] Server health check timed out after 60 seconds")
			l.logger.Println("[ERROR] Server did not respond. Check the log above for error messages.")
			l.logger.Println("[ERROR] ===========================================")
			l.logger.Println("[ERROR] Mögliche Probleme:")
			l.logger.Println("[ERROR]  - Server startet, aber hängt sich bei Initialisierung auf")
			l.logger.Println("[ERROR]  - Dependencies werden geladen (kann lange dauern)")
			l.logger.Println("[ERROR]  - Datenbank-Migration läuft")
			l.logger.Println("[ERROR]  - Port 3000 ist blockiert durch Firewall")
			l.logger.Println("[ERROR] ===========================================")

			l.updateProgressLocalized(95, "status.server_timeout", "⏱️ Server-Start Timeout (60s)")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(96, "status.server_no_response", "📋 Server antwortet nicht - prüfe app/logs/")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(97, "status.server_maybe_running", "💡 Server läuft evtl. noch im Hintergrund")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(98, "status.wait_manual_open", "💡 Warte 2-3 Minuten und öffne localhost:3000")
			time.Sleep(2 * time.Second)
			l.updateProgressLocalized(100, "status.closing", "❌ Launcher wird in 15 Sekunden geschlossen...")
			time.Sleep(15 * time.Second)
			l.closeLogging()
			os.Exit(1)
		}
	}

	l.updateProgressLocalized(100, "status.server_started", "Server erfolgreich gestartet!")
	l.logger.Println("[SUCCESS] Server is running and healthy!")
	time.Sleep(500 * time.Millisecond)
	l.updateProgressLocalized(100, "status.redirecting_dashboard", "Weiterleitung zum Dashboard...")
	l.logger.Println("[INFO] Redirecting to dashboard...")
	time.Sleep(500 * time.Millisecond)
	l.sendRedirect()

	// Warte bis Node-Prozess endet (bleibt offen solange App läuft).
	// Das verhindert, dass der Launcher-Prozess einfach stirbt und Node als Zombie weiterläuft.
	if l.logger != nil {
		l.logger.Println("[INFO] Server running. Launcher stays alive to manage Node process lifecycle.")
		l.logger.Println("[INFO] Close this launcher window to also stop the Node.js server.")
	}

	// Blockiere hier bis Node sich selbst beendet (z.B. nach Restart/Exit-Code 75)
	exitStatus := <-processDied
	if l.logger != nil {
		l.logger.Printf("[INFO] Node.js process exited: %v\n", exitStatus)
	}

	l.closeLogging()
	os.Exit(0)
}

// parseChangelogToHTML converts markdown changelog to HTML
func parseChangelogToHTML(markdown string) string {
	lines := strings.Split(markdown, "\n")
	var html strings.Builder
	inList := false

	// Only show the first 50 lines (recent changes)
	maxLines := 50
	if len(lines) > maxLines {
		lines = lines[:maxLines]
	}

	for _, line := range lines {
		line = strings.TrimRight(line, "\r")

		// Skip the title and format line
		if strings.HasPrefix(line, "# Changelog") {
			continue
		}
		if strings.HasPrefix(line, "All notable changes") {
			continue
		}
		if strings.HasPrefix(line, "The format is") {
			continue
		}

		// Handle headers
		if strings.HasPrefix(line, "## ") {
			if inList {
				html.WriteString("</ul>")
				inList = false
			}
			version := strings.TrimPrefix(line, "## ")
			html.WriteString(fmt.Sprintf("<div class='changelog-version'>%s</div>", template.HTMLEscapeString(version)))
		} else if strings.HasPrefix(line, "### ") {
			if inList {
				html.WriteString("</ul>")
				inList = false
			}
			title := strings.TrimPrefix(line, "### ")
			html.WriteString(fmt.Sprintf("<h3>%s</h3>", template.HTMLEscapeString(title)))
		} else if strings.HasPrefix(line, "- ") {
			if !inList {
				html.WriteString("<ul>")
				inList = true
			}
			item := strings.TrimPrefix(line, "- ")
			// Handle bold text **text** by replacing pairs of **
			for strings.Contains(item, "**") {
				// Find first pair and replace
				firstPos := strings.Index(item, "**")
				if firstPos != -1 {
					// Replace first ** with <strong>
					item = item[:firstPos] + "<strong>" + item[firstPos+2:]
					// Find next ** and replace with </strong>
					secondPos := strings.Index(item[firstPos:], "**")
					if secondPos != -1 {
						actualPos := firstPos + secondPos
						item = item[:actualPos] + "</strong>" + item[actualPos+2:]
					} else {
						// Unmatched **, revert the change
						item = strings.Replace(item, "<strong>", "**", 1)
						break
					}
				} else {
					break
				}
			}
			html.WriteString(fmt.Sprintf("<li>%s</li>", item))
		} else if strings.TrimSpace(line) == "" {
			if inList {
				html.WriteString("</ul>")
				inList = false
			}
		} else if !strings.HasPrefix(line, "[") {
			// Regular paragraph
			if inList {
				html.WriteString("</ul>")
				inList = false
			}
			if strings.TrimSpace(line) != "" {
				html.WriteString(fmt.Sprintf("<p>%s</p>", template.HTMLEscapeString(line)))
			}
		}
	}

	if inList {
		html.WriteString("</ul>")
	}

	return html.String()
}

func main() {
	launcher := NewLauncher()

	// Get executable directory
	exePath, err := os.Executable()
	if err != nil {
		log.Fatal("Kann Programmverzeichnis nicht ermitteln:", err)
	}

	exeDir := filepath.Dir(exePath)
	launcher.exeDir = exeDir
	launcher.appDir = filepath.Join(exeDir, "app")
	templatePath := filepath.Join(exeDir, "build-src", "assets", "launcher.html")

	// Setup logging immediately
	if err := launcher.setupLogging(launcher.appDir); err != nil {
		// If logging fails, create a fallback logger that does nothing
		// (since stdout doesn't exist in GUI mode)
		launcher.logger = log.New(io.Discard, "", log.LstdFlags)
	}

	launcher.logAndSync("Launcher started successfully")
	launcher.logAndSync("Executable directory: %s", exeDir)
	launcher.logAndSync("App directory: %s", launcher.appDir)

	// Resolve persistent config paths and ensure user_configs exists
	launcher.initConfigPaths()

	// Load user profiles
	launcher.loadUserProfiles()

	// Load default translations so status updates can use them immediately
	launcher.loadTranslations(launcher.locale)
	launcher.statusKey = "status.initializing"
	launcher.statusFallback = "Initialisiere..."
	launcher.status = launcher.translateStatus("status.initializing", "Initialisiere...")

	// Setup HTTP server
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Get language from query parameter or use default
		lang := r.URL.Query().Get("lang")
		if lang == "" {
			lang = launcher.locale
		} else {
			valid := false
			for _, l := range allowedLocales {
				if lang == l {
					valid = true
					break
				}
			}
			if valid {
				launcher.locale = lang
			} else {
				lang = launcher.locale
			}
		}

		// Get theme from query parameter (default to night)
		theme := r.URL.Query().Get("theme")
		switch theme {
		case "day", "night", "highcontrast":
		default:
			theme = "night"
		}

		// Load translations
		launcher.loadTranslations(lang)
		launcher.status = launcher.currentStatus()
		
		// Reload profiles if they haven't been loaded recently (cache for 5 seconds)
		if time.Since(launcher.profilesLoaded) > 5*time.Second {
			launcher.loadUserProfiles()
		}

		// Parse template
		tmpl, err := template.ParseFiles(templatePath)
		if err != nil {
			launcher.logAndSync("[ERROR] Could not load template: %v", err)
			http.Error(w, "Template error", http.StatusInternalServerError)
			return
		}

		// Prepare template data
		data := map[string]interface{}{
			"AppName":            launcher.getTranslation("app_name"),
			"TagLine":            "Open-Source TikTok LIVE Tool",
			"Locale":             lang,
			"Version":            "1.2.1",
			"HasProfiles":        len(launcher.profiles) > 0,
			"Profiles":           launcher.profiles,
			"ProfileLabel":       launcher.getTranslation("profile.title"),
			"NoProfilesText":     launcher.getTranslation("profile.no_profiles"),
			"TabChangelog":       launcher.getTranslation("tabs.changelog"),
			"TabApiKeys":         launcher.getTranslation("tabs.api_keys"),
			"TabCommunity":       launcher.getTranslation("tabs.community"),
			"StatusTitle":        launcher.getTranslation("status.progress"),
			"StatusInitializing": launcher.getTranslation("status.initializing"),
			"ChangelogTitle":     launcher.getTranslation("changelog.title"),
			"ChangelogLoading":   launcher.getTranslation("changelog.loading"),
			"ChangelogError":     launcher.getTranslation("changelog.error"),
			"ApiKeysTitle":       launcher.getTranslation("api_keys.title"),
			"ApiKeysIntro":       launcher.getTranslation("api_keys.intro"),
			"MandatoryWarning":   launcher.getTranslation("api_keys.mandatory_warning"),
			"FallbackWarning":    launcher.getTranslation("api_keys.fallback_warning"),
			"ElevenLabsDesc":     launcher.getTranslation("api_keys.elevenlabs.description"),
			"OpenAIDesc":         launcher.getTranslation("api_keys.openai.description"),
			"SiliconFlowDesc":    launcher.getTranslation("api_keys.siliconflow.description"),
			"FishAudioDesc":      launcher.getTranslation("api_keys.fishAudio.description"),
			"CommunityTitle":     launcher.getTranslation("community.title"),
			"CommunityIntro":     launcher.getTranslation("community.intro"),
			"HelpAppreciated":    launcher.getTranslation("community.help_appreciated"),
			"LinkRepo":           launcher.getTranslation("community.links.repo"),
			"LinkDiscussions":    launcher.getTranslation("community.links.discussions"),
			"LinkIssues":         launcher.getTranslation("community.links.issues"),
			"LinkDiscord":        launcher.getTranslation("community.links.discord"),
			"ContributeQuestion": launcher.getTranslation("community.contribute"),
			"ContributeText":     launcher.getTranslation("community.contribute_text"),
			"PoweredBy":          launcher.getTranslation("footer.powered_by"),
			"ThemeLabel":         launcher.getTranslation("theme.label"),
			"ThemeDay":           launcher.getTranslation("theme.daymode"),
			"ThemeNight":         launcher.getTranslation("theme.nightmode"),
			"ThemeHighContrast":  launcher.getTranslation("theme.highcontrast"),
			"KeepOpenLabel":      launcher.getTranslation("options.keep_open"),
			"KeepOpenHint":       launcher.getTranslation("options.keep_open_hint"),
			"OpenAppLabel":       launcher.getTranslation("options.open_app"),
			"AppNotReady":        launcher.getTranslation("options.app_not_ready"),
			"AppReady":           launcher.getTranslation("options.app_ready"),
			"TabLogs":            launcher.getTranslation("tabs.logging"),
			"LogsTitle":          launcher.getTranslation("logs.title"),
			"LogsIntro":          launcher.getTranslation("logs.intro"),
			"LogsLoading":        launcher.getTranslation("logs.loading"),
			"LogsEmpty":          launcher.getTranslation("logs.empty"),
			"LogsError":          launcher.getTranslation("logs.error"),
			"CurrentTheme":       theme,
		}

		tmpl.Execute(w, data)
	})

	http.HandleFunc("/logo", func(w http.ResponseWriter, r *http.Request) {
		// Get theme from query parameter (default: night)
		theme := r.URL.Query().Get("theme")
		if theme == "" {
			theme = "night"
		}

		// Determine logo path based on theme
		var themeLogoPath string
		switch theme {
		case "day":
			themeLogoPath = filepath.Join(launcher.appDir, "public", "ltthlogo_daymode.png")
		case "highcontrast":
			themeLogoPath = filepath.Join(launcher.appDir, "public", "ltthlogo_night-highcontrast-mode.png")
		default: // night
			themeLogoPath = filepath.Join(launcher.appDir, "public", "ltthlogo_nightmode.png")
		}

		http.ServeFile(w, r, themeLogoPath)
	})

	http.HandleFunc("/logs", func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		var parts []string

		// Include launcher log if available
		if launcher.logFile != nil {
			if content, err := launcher.readLogContent(launcher.logFile.Name()); err == nil {
				parts = append(parts, fmt.Sprintf("=== Launcher Log ===\n%s", content))
			} else if launcher.logger != nil {
				launcher.logger.Printf("[WARNING] Could not read launcher log: %v\n", err)
			}
		}

		// Include server log (latest app log) if available
		serverLogPath := launcher.findLatestServerLog()
		if serverLogPath != "" && (launcher.logFile == nil || filepath.Clean(serverLogPath) != filepath.Clean(launcher.logFile.Name())) {
			if content, err := launcher.readLogContent(serverLogPath); err == nil {
				parts = append(parts, fmt.Sprintf("=== Server Log (%s) ===\n%s", filepath.Base(serverLogPath), content))
			} else if launcher.logger != nil {
				launcher.logger.Printf("[WARNING] Could not read server log: %v\n", err)
			}
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		if len(parts) == 0 {
			w.WriteHeader(http.StatusOK)
			return
		}

		w.Write([]byte(strings.Join(parts, "\n\n")))
	})

	http.HandleFunc("/api/select-profile", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		profile := r.URL.Query().Get("profile")
		launcher.selectedProfile = profile
		launcher.logAndSync("[INFO] Selected profile: %s", profile)

		// Save selected profile to file for the app to use
		if err := os.MkdirAll(launcher.userConfigsDir, 0755); err != nil && launcher.logger != nil {
			launcher.logger.Printf("[WARNING] Could not ensure user_configs dir: %v\n", err)
		}
		profileFile := filepath.Join(launcher.userConfigsDir, ".active_profile")
		os.WriteFile(profileFile, []byte(profile), 0644)

		w.WriteHeader(http.StatusOK)
	})

	http.HandleFunc("/changelog", func(w http.ResponseWriter, r *http.Request) {
		changelogPath := filepath.Join(exeDir, "CHANGELOG.md")
		content, err := os.ReadFile(changelogPath)
		if err != nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte("<p style='color: #999;'>Changelog konnte nicht geladen werden.</p>"))
			return
		}

		// Parse markdown and convert to HTML (simple conversion)
		html := parseChangelogToHTML(string(content))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	})

	http.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		client := make(chan string, 10)
		launcher.clientsMu.Lock()
		launcher.clients[client] = true
		launcher.clientsMu.Unlock()

		// Send initial state
		msg := fmt.Sprintf(`{"progress": %d, "status": "%s"}`, launcher.progress, launcher.currentStatus())
		fmt.Fprintf(w, "data: %s\n\n", msg)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}

		// Listen for updates
		for {
			select {
			case msg := <-client:
				fmt.Fprintf(w, "data: %s\n\n", msg)
				if f, ok := w.(http.Flusher); ok {
					f.Flush()
				}
			case <-r.Context().Done():
				launcher.clientsMu.Lock()
				delete(launcher.clients, client)
				launcher.clientsMu.Unlock()
				return
			}
		}
	})

	// Bind HTTP server – try fixed port first, fall back to any available port
	listener, err := net.Listen("tcp", "127.0.0.1:58734")
	if err != nil {
		launcher.logAndSync("[WARNING] Port 58734 in use, using a random available port")
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			launcher.logAndSync("[ERROR] Cannot bind launcher UI server: %v", err)
			os.Exit(1)
		}
	}
	launcherAddr := listener.Addr().String()
	launcherURL := fmt.Sprintf("http://%s", launcherAddr)
	launcher.logAndSync("[INFO] Launcher UI listening on %s", launcherAddr)

	// Start HTTP server
	go func() {
		if err := http.Serve(listener, nil); err != nil {
			launcher.logAndSync("[ERROR] Launcher HTTP server stopped: %v", err)
		}
	}()

	// Give server time to start
	time.Sleep(500 * time.Millisecond)

	// Open browser
	browser.OpenURL(launcherURL)

	// Run launcher
	go launcher.runLauncher()

	// Signal-Handler: Node-Prozess beim Beenden des Launchers sauber terminieren
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		sig := <-sigCh
		if launcher.logger != nil {
			launcher.logger.Printf("[INFO] Signal received (%v) – shutting down Node.js...\n", sig)
		}
		launcher.killNodeProcess()
		launcher.closeLogging()
		os.Exit(0)
	}()

	// Keep running
	select {}
}
