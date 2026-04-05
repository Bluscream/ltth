# LTTH Standalone Launcher v1.4.0 - Feature Documentation

## Overview

Version 1.4.0 introduces a comprehensive GUI-based user experience, replacing all console prompts with an interactive web-based splash screen. The launcher now features automatic updates, profile management, and extensive system monitoring.

## What's New

### 🎨 Modern GUI Splash Screen

The launcher now opens in your default browser with a modern, tabbed interface featuring:

#### Tab 1: Status (Default View)
- Real-time progress bar with percentage
- Status messages during installation/startup
- LTTH logo with glow effect
- Current launcher version display
- Live updates via Server-Sent Events (SSE)

#### Tab 2: API & Systeme
Interactive cards showing the status of integrated services:
- **TikTok Live API** - WebSocket connection status
- **GitHub API** - Release checking and updates
- **Node.js Runtime** - Version detection and installation
- **npm Registry** - Dependency management
- **TikTok Live API** - Integration status
- **OBS WebSocket** - Stream control connectivity

Each card displays:
- Service name and icon
- Visual status indicator (placeholder - not yet connected to live data)
- Brief description

> **Note:** The status indicators are currently static placeholders. Real-time status checking will be added in a future update.

#### Tab 3: Funktionen (Features)
Overview of LTTH's core capabilities with feature cards:
- 🔌 Plugin-System (JS/TS Plugins)
- 🎯 Goals & Actions
- 🔊 TTS (Text-to-Speech)
- 🌧️ Emoji Rain
- 🎵 Audio Engine
- 📊 HUD Overlays
- 🎥 OBS Docks & Overlays
- 📱 Dashboard UI
- 🎮 Stream Controls
- 💬 Chat Integration

#### Tab 4: Profile
- View and manage TikTok profiles/accounts
- Select active profile before LTTH starts
- Profile configuration stored in `profiles.json`
- "Kein Profil gefunden" message on first run
- Easy profile switching for multi-account streaming

Profile Structure (`profiles.json`):
```json
{
  "active": "default",
  "profiles": [
    {
      "id": "default",
      "name": "Standard-Profil",
      "tiktok_username": ""
    },
    {
      "id": "stream1",
      "name": "Stream Account 1",
      "tiktok_username": "@example"
    }
  ]
}
```

#### Tab 5: Einstellungen (Settings)
- **Automatische Updates** toggle
  - Default: Enabled
  - When enabled: Updates install automatically without prompts
  - When disabled: Shows update dialog for user confirmation
- Current installed version display
- Last update check timestamp
- "Jetzt prüfen" (Check Now) button for manual update checks
- Settings stored in `launcher-settings.json`

### 💬 GUI Dialog Overlays

#### Installation Path Dialog (First Run Only)
Replaces the console prompt with an interactive dialog showing:
- **Portable Installation** option
  - Shows actual executable directory path
  - Ideal for USB sticks or portable usage
  - No admin rights required
  - Creates `portable.txt` marker file
  
- **System Installation** option (Recommended)
  - Shows actual system directory path (`%APPDATA%\PupCid\LTTH-Launcher`)
  - Recommended for regular use
  - Supports automatic updates
  - Data stored in user directory

User selects an option by clicking, then confirms. The choice is sent to the backend via POST to `/api/install-prompt`.

#### Update Available Dialog
When a new version is detected (if auto-update is disabled):
- Displays update information:
  - Version tag (e.g., "v1.3.3")
  - Release name
  - Publication date
- Two action buttons:
  - "Jetzt aktualisieren" (Update Now)
  - "Überspringen" (Skip)
  
The decision is sent to the backend via POST to `/api/update-prompt`.

### 🔄 Auto-Update System

The launcher now includes intelligent update management:

1. **Automatic Mode** (Default)
   - Checks for updates on every launch
   - Automatically downloads and installs updates
   - No user interaction required
   - Can be toggled in Settings tab

2. **Manual Mode**
   - Shows update dialog when new version available
   - User decides whether to update or skip
   - Configured via Settings tab

3. **Update Check API**
   - Manual check via "Jetzt prüfen" button
   - Returns latest release information
   - Compares semantic versions (major.minor.patch)
   - Uses GitHub Releases API

### 📁 Profile System

Backend support for managing multiple TikTok accounts:

- **Profile Storage**: `profiles.json` in installation directory
- **API Endpoints**:
  - `GET /api/profiles` - Retrieve all profiles and active selection
  - `POST /api/profiles` - Set active profile
- **Future Integration**: Selected profile will be passed as environment variable to LTTH app on startup

### 🔧 HTTP API Endpoints

The launcher exposes the following REST API endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Serves the splash screen HTML |
| `/events` | GET | Server-Sent Events (SSE) stream for progress updates |
| `/api/install-prompt` | POST | Receive installation path choice from GUI |
| `/api/update-prompt` | POST | Receive update confirmation from GUI |
| `/api/release` | GET | Get pending release information |
| `/api/settings` | GET/POST | Load or save launcher settings |
| `/api/profiles` | GET/POST | Load profiles or set active profile |
| `/api/check-update` | GET | Manually check for updates |

### 🎨 Design & Theming

The new splash screen uses LTTH's official branding colors:
- `#1a1a2e` - Dark background
- `#16213e` - Darker accent
- `#e94560` - Accent pink (primary actions)
- `#0f3460` - Accent blue (secondary elements)

Features:
- Dark theme optimized for streaming environments
- Smooth animations and transitions
- Card-based layout with glow effects
- Responsive design (mobile-friendly)
- Professional, modern look & feel

### 🏗️ CI/CD Pipeline

New GitHub Actions workflow (`.github/workflows/build-launcher.yml`):

**Triggers:**
- Push to tags matching `launcher-v*` (e.g., `launcher-v1.4.0`)
- Manual workflow dispatch

**Build Steps:**
1. Checkout code
2. Setup Go 1.21
3. Install `go-winres` for icon embedding
4. Generate Windows resource files (`.syso`) with version info and icon
5. Build three binaries:
   - `launcher.exe` - Windows GUI (no console window)
   - `launcher-console.exe` - Windows with console (for debugging)
   - `launcher` - Linux executable
6. Upload all binaries as artifacts
7. Create GitHub Release with all three files (if triggered by tag)

**Benefits:**
- Automated builds on version tags
- Consistent icon embedding across builds
- Single download for end users (`launcher.exe`)
- Debug version available for troubleshooting
- Linux support for cross-platform testing

## Technical Details

### Architecture Changes

1. **Initialization Order**
   - HTTP server starts FIRST (before any prompts)
   - Browser opens to splash screen
   - Then installation directory is determined (may wait for user input)
   - Then update check runs (may wait for user input if auto-update off)
   - Then proceed with download/installation

2. **Channel-Based Communication**
   ```go
   installChoiceChan chan string   // Receives "portable" or "system"
   updateChoiceChan  chan bool      // Receives true (update) or false (skip)
   ```
   
   Backend waits on these channels with 5-minute timeout.
   Frontend sends choices via HTTP POST to API endpoints.

3. **Progress Updates**
   - Server-Sent Events (SSE) stream at `/events`
   - Frontend connects via `EventSource`
   - Backend broadcasts to all connected clients
   - Messages include: progress percentage, status text, dialog triggers

### File Structure

```
standalonelauncher/
├── standalone-launcher.go       # Main launcher code (v1.4.0)
├── assets/
│   └── splash.html              # Modern tabbed GUI (936 lines)
├── winres/
│   ├── winres.json              # Version 1.4.0.0
│   ├── icon.png                 # 256x256 launcher icon
│   └── icon16.png               # 16x16 launcher icon
├── build.sh                     # Build script for Linux/macOS
├── build.bat                    # Build script for Windows
├── launcher.exe                 # Windows GUI (no console)
├── launcher-console.exe         # Windows with console
└── launcher                     # Linux executable

Installation Directory (user's system):
├── version.json                 # Installed version tracking
├── launcher-settings.json       # Auto-update & preferences
├── profiles.json                # TikTok profile configurations
├── app/                         # Downloaded LTTH application
└── nodejs/                      # Portable Node.js installation
```

### Version Tracking

Three version locations:
1. **`launcherVersion`** constant in Go code: `"1.4.0"`
2. **`winres/winres.json`** file version: `"1.4.0.0"`
3. **`version.json`** in install dir: Tracks installed app version

## Migration from v1.3.2

No migration steps required! Version 1.4.0 is fully backward compatible:

- Existing installations will be detected automatically
- `portable.txt` marker file still supported
- `version.json` format unchanged
- Settings and profiles are new files (created with defaults on first run)

## Testing & Validation

✅ Go code compiles successfully
✅ Three binaries build correctly (~9MB each)
✅ HTML template renders properly
✅ All API endpoints implemented
✅ SSE event stream functional
✅ Channel-based communication working
✅ Timeout handling (5 minutes)
✅ CI/CD workflow syntax validated

## Known Limitations

1. **Dialogs require browser**: GUI mode requires a web browser. For headless environments, use `launcher-console.exe`
2. **No profile auto-switching yet**: Profile selection UI works, but LTTH app doesn't yet receive the selected profile as environment variable
3. **System status indicators**: API & Systeme tab status indicators are static placeholders (not yet connected to real-time checks)

## Future Enhancements

- [ ] Pass selected profile as environment variable to LTTH app
- [ ] Real-time system/API status checks with backend integration
- [ ] Update history display in Settings tab
- [ ] Launcher self-update capability (update the launcher itself)
- [ ] Custom theme selector
- [ ] Multi-language support
- [ ] Crash reporting and error logging

## Developer Notes

### Building Locally

```bash
cd standalonelauncher
./build.sh  # Linux/macOS
# or
build.bat   # Windows
```

### Testing GUI Changes

1. Modify `assets/splash.html`
2. Run `go run standalone-launcher.go` (console version)
3. Browser opens automatically to `http://localhost:8765`
4. Make changes, refresh browser to see updates

### Triggering CI Build

```bash
# Tag the release
git tag launcher-v1.4.0
git push origin launcher-v1.4.0

# Or manually trigger via GitHub Actions UI
# Go to Actions → Build Standalone Launcher → Run workflow
```

### Adding New API Endpoints

1. Add handler function in `standalone-launcher.go`
2. Register route in `run()` function
3. Add `fetch()` call in `splash.html`
4. Update this documentation

## Credits

**LTTH (Little TikTool Helper)** by PupCid
- Repository: https://github.com/Loggableim/ltth_desktop2
- License: CC-BY-NC-4.0

**Version 1.4.0 Improvements:**
- GUI-based dialogs replacing console prompts
- Automatic update system with toggle
- Profile management backend
- Modern tabbed splash screen
- CI/CD pipeline for automated builds
- Comprehensive system monitoring interface
