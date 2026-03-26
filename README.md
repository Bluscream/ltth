# 🎮 PupCid's Little TikTool Helper (LTTH)

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Node.js](https://img.shields.io/badge/Node.js-18.0.0+-green.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-33.0.0+-blue.svg)](https://www.electronjs.org/)
[![Version](https://img.shields.io/badge/Version-1.3.3-blue.svg)](CHANGELOG.md)

Professional TikTok-compatible LIVE streaming tool with overlays, alerts, Text-to-Speech, automation, and an extensive plugin ecosystem. Built with Node.js, Express.js, Socket.IO, and Electron.

---

## 🌟 Über das Projekt

Dieses Tool wird von mir als Solo-Entwickler zusammen mit Claude AI entwickelt. Es bietet eine umfassende Lösung für TikTok LIVE Streaming mit Overlays, Alerts, TTS, Soundboard und Event-Automatisierung.

**Bugs oder Feedback?** → [loggableim@gmail.com](mailto:loggableim@gmail.com)

---

## ✨ Hauptfunktionen

### 🔴 TikTok LIVE Integration
- Live-Verbindung über Username mit Eulerstream API
- Echtzeit-Events (Gifts, Follows, Shares, Likes, Chat, Subs)
- Auto-Reconnect bei Verbindungsabbruch
- Live-Statistiken und Gift-Katalog

### 🎤 Text-to-Speech
- 75+ TikTok-Stimmen, 30+ Google Cloud-Stimmen (optional)
- User-spezifisches Voice-Mapping
- Automatisches TTS für Chat-Nachrichten
- Blacklist, Volume, Speed anpassbar

### 🎬 Alert-System
- Anpassbare Alerts für alle Event-Typen
- Sound + Text + Bild/GIF Support
- Template-System mit Variablen
- Mindest-Coins-Filter

### 🎵 Soundboard
- 100.000+ Sounds von MyInstants
- Gift-spezifische Sounds mit Icons
- Event-Sounds (Follow, Subscribe, Share)
- Like-Threshold-System

### 🎯 Goals & Overlays
- 4 separate Goals (Likes, Followers, Subs, Coins)
- Individuelle Browser-Source-Overlays pro Goal
- OBS-Integration mit transparentem Full-HD-Overlay
- HUD-Konfiguration per Drag & Drop

### ⚡ Event-Automation (Flows)
- "Wenn-Dann"-Automatisierungen ohne Code
- 6 Trigger-Typen, 6 Action-Typen
- Komplexe Bedingungen mit 8 Operatoren

### 🔌 Plugin-System
- Modulare plugin-basierte Architektur
- Einfach erweiterbar mit eigener Funktionalität
- **31 eingebaute Plugins** (6 Early Beta, 10 Beta, 8 Alpha, 7 Final)
- **AnimazingPal v1.3** mit Brain Engine (KI-Gedächtnis, Persönlichkeiten, Batch Processing)
- WebGPU-Engine für GPU-beschleunigte Effekte
- Global Chat Command Engine (GCCE)

### 🤖 AnimazingPal Brain Engine (v1.3 NEU)
- **KI-Langzeitgedächtnis** mit semantischer Vektorsuche
- **Persönlichkeiten-System** (5 vordefiniert + Custom)
- **User-Profile** mit Beziehungs-Tracking
- **Batch Processing** für natürlichen Sprachfluss
- **Relevanz-Erkennung** (Fragen, Grüße, Spam-Filter)
- **GPT-Powered Antworten** (GPT-4o-mini, GPT-5 Nano)
- **Memory Decay** mit Auto-Archivierung

---

## 📚 Dokumentation

**📖 [Vollständiger Dokumentations-Index](DOCUMENTATION_INDEX.md)** - Übersicht aller Dokumentationen

**Vollständige Wiki-Dokumentation:** [`app/wiki/`](app/wiki/)

### Schnellzugriff für Nutzer

- **[Wiki-Index](app/wiki/Wiki-Index.md)** - Vollständige Übersicht aller Dokumentationsseiten
- **[Getting Started](app/wiki/Getting-Started.md)** - 5-Minuten-Schnelleinstieg
- **[Plugin-Liste](app/wiki/Plugin-Liste.md)** - Alle 31 Plugins mit Details
- **[Overlays & Alerts](app/wiki/Overlays-&-Alerts.md)** - 25+ OBS-Overlays
- **[Advanced Features](app/wiki/Advanced-Features.md)** - WebGPU, GCCE, Performance
- **[FAQ & Troubleshooting](app/wiki/FAQ-&-Troubleshooting.md)** - Probleme lösen

### Für Entwickler (English)

- **[LLM Start Here](infos/llm_start_here.md)** - Comprehensive technical guide (START HERE!)
- **[Contributing Guide](infos/CONTRIBUTING.md)** - Contribution guidelines
- **[Architecture](infos/ARCHITECTURE.md)** - System architecture
- **[Plugin Development](infos/PLUGIN_DEVELOPMENT.md)** - Create plugins
- **[Development Setup](infos/DEVELOPMENT.md)** - Development environment
- **[Testing Guide](infos/TESTING.md)** - Testing strategies
- **[Security Guide](infos/SECURITY.md)** - Security best practices

### Für Entwickler (Deutsch)

- **[Entwickler-Leitfaden](app/wiki/Entwickler-Leitfaden.md)** - Coding-Standards
- **[Plugin-Dokumentation](app/wiki/Plugin-Dokumentation.md)** - Plugin-Entwicklung
- **[API-Reference](app/wiki/API-Reference.md)** - REST-API & WebSocket
- **[Architektur](app/wiki/Architektur.md)** - System-Architektur

---

## 🚀 Schnellstart

### Voraussetzungen

- **Node.js 18.0.0+** (Download: [nodejs.org](https://nodejs.org/))
- Moderner Browser (Chrome, Firefox, Edge)
- **OBS Studio** (für Overlays, optional)
- **Eulerstream API Key** (erforderlich für TikTok-Verbindung)

### Installation

#### Option 1: Desktop App (Empfohlen)

Die Desktop-Version mit Electron bietet eine vollständige, eigenständige Installation:

```bash
# Repository klonen
git clone https://github.com/Loggableim/ltth_dev.git
cd ltth_dev

# Dependencies installieren
npm install

# Desktop-App starten
npm run start:electron
```

#### Option 2: Standalone Server

Nur den Backend-Server ohne Electron starten:

```bash
# In den app-Ordner wechseln
cd app

# Dependencies installieren
npm install

# Server starten
npm start
```

Der Server läuft auf `http://localhost:3000`

### 🔑 Eulerstream API Key konfigurieren

**WICHTIG:** Ein Eulerstream API Key ist erforderlich, um sich mit TikTok LIVE zu verbinden.

1. API Key erhalten: [https://www.eulerstream.com](https://www.eulerstream.com)
2. Konfiguration über eine der folgenden Optionen:
   - `.env` Datei im `app/` Ordner erstellen: `EULER_API_KEY=dein_api_key_hier`
   - Dashboard Settings nach dem Start: `http://localhost:3000` → Settings

**🔄 Backup Key:**  
Die App enthält einen Euler Backup Key für Notfälle. Wenn dieser verwendet wird, erscheint eine 10-Sekunden-Warnung mit der Aufforderung, einen eigenen kostenlosen API-Key von [eulerstream.com](https://www.eulerstream.com) zu holen. **Bitte nutze deinen eigenen Key!**

**Detaillierte Anleitung:** Siehe [`app/README.md`](app/README.md)

---

## 📦 Projekt-Struktur

```
pupcidslittletiktokhelper/
├── main.js                        # Electron main process
├── package.json                   # Electron app configuration
├── launcher.exe                   # Windows launcher
│
├── app/                           # Backend application
│   ├── server.js                  # Express server
│   ├── README.md                  # Detaillierte Dokumentation
│   ├── package.json               # Backend dependencies
│   ├── modules/                   # Core modules
│   │   ├── database.js
│   │   ├── tiktok.js
│   │   ├── tts.js
│   │   ├── alerts.js
│   │   ├── flows.js
│   │   └── plugin-loader.js
│   ├── plugins/                   # Plugin ecosystem
│   ├── public/                    # Frontend assets
│   ├── routes/                    # API routes
│   └── test/                      # Tests
│
├── build-src/                     # Launcher source code
│   ├── launcher-gui.go            # GUI launcher
│   ├── launcher.go                # Console launcher
│   └── README.md                  # Build instructions
│
└── .github/                       # GitHub configuration
    ├── copilot-instructions.md    # Development guidelines
    └── workflows/                 # CI/CD workflows
```

---

## 📚 Dokumentation

### Aktuelle Dokumentation (v1.2)
- **[App-Dokumentation](app/README.md)** - Vollständige Features, API, Troubleshooting
- **[Build-Anleitung](build-src/README.md)** - Windows Launcher kompilieren
- **[Changelog](CHANGELOG.md)** - Version history und Release Notes
- **[Copilot Guidelines](.github/copilot-instructions.md)** - Development standards

### Archivierte Dokumentation (v1.1)
Ältere Dokumentationen und detaillierte Implementierungs-Summaries wurden archiviert:
- **[Archived Docs](docs_archive/)** - Desktop App Migration Optionen, GCCE Integration, Fix Summaries
- **[Migration Guides](migration-guides/)** - Step-by-Step Anleitungen (NSIS, NW.js, Tauri)

> **Hinweis:** Die archivierten Dateien enthalten wertvolle technische Details zu früheren Implementierungen und sind weiterhin als Referenz verfügbar.

---

## 🎬 OBS Einrichtung

### Haupt-Overlay
1. Source → Browser Source
2. URL: `http://localhost:3000/overlay.html`
3. Breite: 1920, Höhe: 1080
4. ✅ "Shutdown source when not visible" deaktivieren

### Goal-Overlays (Optional)
```
http://localhost:3000/goal/likes
http://localhost:3000/goal/followers
http://localhost:3000/goal/subs
http://localhost:3000/goal/coins
```

### Animations-Overlay (Optional)
- URL: `http://localhost:3000/animation-overlay.html`
- Breite: 1920, Höhe: 1080
- Für Follow/Subscribe/Share/Gift Animationen

---

## 🔧 Development

### Backend-Server starten (mit Hot-Reload)
```bash
cd app
npm run dev
```

### Electron Desktop App
```bash
# Development-Modus
npm run dev

# Production Build
npm run build              # Alle Plattformen
npm run build:win          # Windows
npm run build:mac          # macOS
npm run build:linux        # Linux
```

### Tests ausführen
```bash
cd app
npm test                   # Alle Tests
npm run test:watch         # Watch-Modus
npm run test:coverage      # Coverage Report
```

### Linting
```bash
npm run lint
```

---

## 🤝 Contributing

Pull Requests sind willkommen! Bitte beachte:

1. Fork das Repository
2. Branch erstellen: `git checkout -b feature/name`
3. Code-Standards einhalten (siehe [`.github/copilot-instructions.md`](.github/copilot-instructions.md))
4. Tests hinzufügen für neue Features
5. Commit: `git commit -m 'Add feature'`
6. Push: `git push origin feature/name`
7. Pull Request öffnen

**Bug-Reports & Feature-Requests:**
- GitHub Issues
- E-Mail: [loggableim@gmail.com](mailto:loggableim@gmail.com)

---

## 🛠️ Technologie-Stack

### Backend
- **Node.js 18+** - Runtime
- **Express.js** - Web framework
- **Socket.IO** - Real-time communication
- **Better-SQLite3** - Database (WAL mode)
- **Winston** - Logging with daily rotation

### Frontend
- **Tailwind CSS** - Styling
- **Socket.IO Client** - Real-time updates
- **Vanilla JavaScript** - No framework dependencies

### Desktop
- **Electron 33+** - Desktop application
- **electron-builder** - Build & packaging
- **electron-updater** - Auto-updates

### Integrations
- **Eulerstream API** - TikTok LIVE connection
- **TikTok TTS API** - Text-to-Speech
- **MyInstants** - Sound library
- **OBS WebSocket v5** - OBS integration (optional)

### Performance Optimierungen (v1.2)
- Zentrale Event-Verarbeitung über GCCE (Global Chat Command Engine)
- 60% weniger Event Processing durch Plugin-Konsolidierung
- 50-75% weniger Datenbank-Queries durch zentrale User-Daten-Pipeline
- Optimierte Launcher-Größe (28% Reduktion)

> **Mehr Details:** Siehe archivierte [GCCE Integration Dokumentation](docs_archive/GCCE_PROJECT_SUMMARY.md)

---

## 📄 Lizenz

**CC BY-NC 4.0** - Creative Commons Attribution-NonCommercial 4.0 International

- ✅ Privat nutzen
- ✅ Modifizieren und teilen
- ✅ Mit Attribution
- ❌ Keine kommerzielle Nutzung

Siehe [LICENSE](LICENSE) für Details.

---

## 🙏 Credits

- [Eulerstream](https://www.eulerstream.com/) - TikTok LIVE WebSocket API
- [TikTok TTS API](https://github.com/oscie57/tiktok-voice) by @oscie57
- [MyInstants](https://www.myinstants.com/) - Sound library
- [Tailwind CSS](https://tailwindcss.com/)
- [Socket.IO](https://socket.io/)
- [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3)
- [Electron](https://www.electronjs.org/)

---

## ⚠️ Disclaimer

**PupCid's Little TikTool Helper ist ein unabhängiges Analyse- und Creator-Tool. Es besteht keine geschäftliche, partnerschaftliche oder technische Verbindung zu TikTok oder ByteDance.**

Dieses Tool nutzt öffentliche APIs und ist nicht offiziell von TikTok unterstützt. Nutzung auf eigene Verantwortung.

- ✅ Keine Login-Daten erforderlich
- ✅ Keine Daten-Sammlung (100% lokal)
- ✅ Open Source
- ⚠️ TikTok-Nutzungsbedingungen beachten

---

## 💬 Support

- 📖 [Vollständige Dokumentation](app/README.md)
- 📋 [Changelog](CHANGELOG.md) - Was ist neu?
- 🗂️ [Archivierte Dokumentation](docs_archive/) - Ältere technische Details
- 🐛 [GitHub Issues](https://github.com/Loggableim/ltth_dev/issues)
- 📧 [loggableim@gmail.com](mailto:loggableim@gmail.com)

---

**Made with ❤️ by PupCid & Claude AI**

**Version 1.3.3** - Feature Release
