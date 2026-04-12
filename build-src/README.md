# Launcher Build Instructions

This directory contains the source code for the Windows launchers.

## Launchers

1. **launcher.exe** - Local launcher for existing installations
2. **ltthgit.exe** - Cloud launcher that downloads files from GitHub

## Launcher Features

### GitHub API Auto-Update

Der Launcher unterstützt zwei Update-Modi:

#### 1. **Release-Modus (Standard, empfohlen)**
Verwendet GitHub Releases für stabile Updates mit semantischer Versionierung.

**Eigenschaften:**
- Lädt nur stabile, getaggte Releases (z.B. v1.2.3)
- Zeigt Release Notes im Update-Prompt
- Vergleicht semantische Versionen (v1.0.0 < v1.1.0 < v2.0.0)
- Version gespeichert in `runtime/version.txt`
- Automatischer Fallback zu Commit-Modus bei Fehler
- Ideal für normale Benutzer

**Release Notes:**
Beim Update-Prompt werden die ersten 10 Zeilen der Release Notes angezeigt:
```
===============================================
  Update verfuegbar!
===============================================

Aktuelle Version: v1.0.0
Neue Version:     v1.2.3

Release Notes:
---
### 🎉 Neue Features
- Feature A
- Feature B
... (gekuerzt)
---

Moechtest du das Update jetzt installieren? (J/N):
```

#### 2. **Commit-Modus (Legacy/Dev)**
Verwendet Commit SHA für bleeding-edge Updates (alter Mechanismus).

**Eigenschaften:**
- Prüft bei jedem Start nach Updates (max. 1x pro 24h)
- Vergleicht neuesten Commit SHA mit lokalem Stand (`runtime/version_sha.txt`)
- User-Prompt für Update-Installation
- Download nur relevanter Dateien:
  - ✅ `app/`, `plugins/`, `game-engine/`, `package.json`, `package-lock.json`
  - ❌ `launcher.exe`, `runtime/`, `logs/`, `data/`, `node_modules/`, `.git/`
- Progress-Anzeige während Download
- Automatische npm install nach Update falls nötig
- Robuste Fehlerbehandlung (min. 90% Erfolgsrate)

**Auto-Erkennung:**
Der Launcher erkennt automatisch den richtigen Modus:
1. **Umgebungsvariable:** `LTTH_UPDATE_MODE` (commit/release/auto)
2. **version.txt existiert:** Release-Modus
3. **version_sha.txt existiert:** Commit-Modus
4. **Keins vorhanden:** Release-Modus (Standard)

**Manuelles Setzen:**
```bash
# Release-Modus erzwingen
set LTTH_UPDATE_MODE=release

# Commit-Modus erzwingen (für Entwickler)
set LTTH_UPDATE_MODE=commit

# Auto-Erkennung (Standard)
set LTTH_UPDATE_MODE=auto
```

**Rate Limiting:**
- Max. 1 Update-Check pro 24h
- Timestamp gespeichert in `runtime/last_update_check.txt`
- Version/SHA gespeichert in `runtime/version.txt` oder `runtime/version_sha.txt`

**Sicherheit:**
- Keine Credentials nötig (GitHub API read-only)
- `launcher.exe` wird NIE überschrieben
- User-Daten geschützt (`runtime/`, `logs/`, `data/`)
- 30 Sekunden Timeout pro Request

### Automatische Node.js Installation
Der Launcher installiert automatisch eine portable Node.js Version (v20.18.1 LTS) falls keine Installation gefunden wird.
Keine User-Interaktion nötig.

**Installation Flow:**
1. Prüft globale Node.js Installation (`node` in PATH)
2. Prüft portable Installation (`runtime/node/node.exe`)
3. Falls keine gefunden: Automatisch portable Installation
   - Download von nodejs.org (ca. 45 MB)
   - Progress-Anzeige während Download
   - Automatische Extraktion nach `runtime/node/`
   - Struktur-Flattening (Root-Ordner wird entfernt)
   - Validierung der Installation

### Auto-Update
Prüft bei jedem Start ob eine neuere Node.js Version verfügbar ist und aktualisiert automatisch.

**Update Mechanismus:**
- Version wird in `runtime/node/version.txt` gespeichert
- Vergleich mit Target-Version im Launcher
- Automatischer Download und Installation
- Backup der alten Version in `runtime/node.backup/`
- Kein Rollback bei Fehler - alte Version bleibt erhalten

### Portable Installation
Node.js wird in `runtime/node/` installiert und benötigt keine Admin-Rechte.

**Datei-Struktur:**
```
LTTH_Desktop/
├── launcher.exe
├── runtime/
│   ├── node/
│   │   ├── node.exe
│   │   ├── npm.cmd
│   │   ├── npx.cmd
│   │   ├── version.txt              # "20.18.1" (Node.js Version)
│   │   └── node_modules/
│   ├── node.backup/                  # Optional: Backup bei Update
│   ├── version.txt                   # Git Release Version (z.B. "v1.2.3") - Release-Modus
│   ├── version_sha.txt               # Git Commit SHA - Commit-Modus
│   └── last_update_check.txt         # Timestamp letzter Update-Check
├── app/
└── ...
```

### Plattform-Unterstützung
- **Windows:** ZIP-Extraktion (primär unterstützt)
- **Linux:** TAR.XZ-Extraktion mit tar command
- **macOS:** TAR.GZ-Extraktion mit tar command

### Fehlerbehandlung
- **Download fehlgeschlagen:** 3 Retry-Versuche, dann manuelle Installations-Anleitung
- **Extraktion fehlgeschlagen:** Cleanup von temporären Dateien
- **Update fehlgeschlagen:** Bestehende Installation bleibt erhalten

## Building the Launchers

The launchers are written in Go and include embedded resources.

### Prerequisites

- Go 1.18 or higher
- `go-winres` tool (for embedding icons in launcher.exe)

### Quick Build (Recommended)

**Use the provided build scripts for automatic cross-compilation:**

```bash
# On Windows:
build-launcher.bat

# On Linux/macOS:
./build-launcher.sh
```

These scripts will automatically:
- Download Go dependencies
- Build all launcher variants with correct flags
- Verify the binaries are Windows executables
- Display file sizes

### Manual Build

### Building on Windows

#### Local Launcher (launcher.exe)

```bash
# Build the GUI launcher (with icon)
go build -o launcher.exe -ldflags "-H windowsgui" launcher-gui.go

# Build the console launcher (without GUI)
go build -o launcher-console.exe launcher.go

# Build the backup launcher with logging (troubleshooting)
go build -o launcher-backup.exe launcher-backup.go

# Build the dev launcher (GUI with visible terminal for debugging)
go build -o dev_launcher.exe dev-launcher.go
```

### Building on Linux/macOS (Cross-Compilation)

**IMPORTANT:** When building launcher.exe on non-Windows systems (e.g., GitHub Actions, Linux, macOS), you MUST use cross-compilation to create Windows binaries:

```bash
# Navigate to build-src directory first
cd build-src

# Cross-compile the GUI launcher for Windows
GOOS=windows GOARCH=amd64 go build -o ../launcher.exe -ldflags "-H windowsgui -s -w" launcher-gui.go

# Cross-compile the console launcher for Windows
GOOS=windows GOARCH=amd64 go build -o ../launcher-console.exe -ldflags "-s -w" launcher.go

# Cross-compile the dev launcher for Windows
GOOS=windows GOARCH=amd64 go build -o ../dev_launcher.exe -ldflags "-s -w" dev-launcher.go
```

**Note:** The `-s -w` flags strip debug information and reduce binary size. The `-H windowsgui` flag is essential for GUI applications to hide the console window on Windows.

**Verification:**
Always verify the built binary is a Windows executable:
```bash
cd ..
file launcher.exe
# Expected output: launcher.exe: PE32+ executable (GUI) x86-64, for MS Windows
```

#### Cloud Launcher (ltthgit.exe)

```bash
# Build the cloud launcher (downloads from GitHub)
go build -o ltthgit.exe -ldflags="-s -w" ltthgit.go

# Copy to project root
cp ltthgit.exe ../
```

**Size:** ~8.5MB (well under 22MB target)

The cloud launcher includes:
- Embedded splash screen HTML
- GitHub repository downloader
- Automatic dependency installation
- Browser-based progress display

## Files

### Local Launcher Files
- `launcher.go` - Console launcher (shows terminal window)
- `launcher-gui.go` - GUI launcher (no terminal, shows graphical progress)
- `dev-launcher.go` - Dev launcher (GUI with visible terminal for debugging)
- `launcher-backup.go` - Backup launcher with detailed logging (troubleshooting)
- `icon.png` - Application icon (1355x1355 PNG)
- `icon.ico` - Icon in ICO format (multi-resolution)
- `winres/winres.json` - Icon and metadata configuration
- `rsrc_windows_*.syso` - Generated Windows resource files (auto-included in build)

### Cloud Launcher Files
- `ltthgit.go` - Cloud launcher source code
- `assets/splash.html` - Embedded splash screen (HTML template)

## Launcher Types

### ltthgit.go (ltthgit.exe) - Cloud Launcher
- **Purpose:** Download and install LTTH from GitHub
- **Size:** ~8.5MB (single executable, no dependencies)
- **Features:**
  - Downloads latest version from GitHub
  - Shows progress in browser
  - Server-Sent Events (SSE) for real-time updates
  - Embedded splash screen with animations
  - Automatic Node.js check and dependency installation
  - Opens application when ready
- **Use when:** 
  - First-time installation
  - Want latest version from GitHub
  - Distributing to users without local files

### launcher-gui.go (launcher.exe) - Local Launcher
- **Purpose:** Main launcher for existing installations
- **Features:**
  - Opens in browser with background image
  - Shows progress bar and status updates
  - Auto-redirects to dashboard when ready
  - No terminal window (windowsgui mode)
- **Use when:** Normal operation with local files

### dev-launcher.go (dev_launcher.exe) - Development Launcher
- **Purpose:** Debugging version of the GUI launcher
- **Features:**
  - Same as launcher-gui.go but with visible terminal window
  - Shows console output and error messages
  - **Server terminal output is visible with detailed error logging**
  - Both launcher and Node.js server output shown in terminal
  - Output is logged to file AND displayed in console
  - **Launcher stays active to monitor server - catches crashes**
  - **Terminal stays open on crash - waits for Enter before closing**
  - **Enhanced crash detection with output flushing (500ms delay)**
  - **Prominent crash messages to ensure visibility**
  - Shows crash details and error logs when server crashes
  - Useful for troubleshooting startup issues and runtime crashes
  - Does NOT use -H windowsgui flag
- **Use when:** 
  - Debugging launcher or startup problems
  - Need to see error logs in terminal
  - Need to see Node.js server errors and output
  - **Server crashes during TikTok Live connection**
  - **Server crashes and you need to see the error logs**
  - Investigating issues before or during app startup

### launcher.go (launcher-console.exe)
- **Purpose:** Simple console launcher
- **Features:**
  - Shows terminal window with colored output
  - Step-by-step progress
  - Pauses before exit
- **Use when:** Quick debugging or preference for terminal

### launcher-backup.go (launcher-backup.exe)
- **Purpose:** Troubleshooting launcher with comprehensive logging
- **Features:**
  - **Detailed logging to launcher-debug.log file**
  - Shows all steps with timestamps
  - Logs system information (OS, architecture)
  - Logs every operation (Node.js check, npm install, etc.)
  - Terminal stays open with colored output
  - Pauses before exit to review errors
- **Use when:** 
  - launcher.exe opens terminal briefly then closes
  - Need to diagnose installation/startup issues
  - Support needs detailed error information
