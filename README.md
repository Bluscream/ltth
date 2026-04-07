# 🎮 PupCid's Little TikTool Helper (LTTH)

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Node.js](https://img.shields.io/badge/Node.js-18.0.0+-green.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-33.0.0+-blue.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0+-blue.svg)](https://www.typescriptlang.org/)

Professional TikTok-compatible LIVE streaming tool with overlays, alerts, Text-to-Speech, automation, and an extensive plugin ecosystem. Now modernized with a **TypeScript architecture** and **Headless Mode** support.

---

## 🚀 Modernized Architecture
The LTTH project has undergone a significant architectural overhaul to improve stability, maintainability, and performance:

- **TypeScript-First**: Full type safety across the main and backend processes.
- **Source Reorganization**: Clean separation of concerns with code moved to `source/main` and `source/backend`.
- **Unified Dependencies**: All modules managed from the root `package.json`.
- **Headless Mode**: Native support for background execution via the `--headless` flag.

## ✨ Core Features
- 🔴 **TikTok LIVE Integration**: Real-time event tracking via Eulerstream API.
- 🎤 **Text-to-Speech**: 75+ TikTok voices with per-user voice mapping.
- 🎬 **Alert System**: Fully customizable OBS browser alerts.
- 🎵 **Soundboard**: Integrated search for 100k+ sounds via MyInstants.
- 🎯 **Goals & Overlays**: Drag & drop HUD configuration for OBS.
- 🔌 **Plugin System**: Modular architecture with 30+ built-in plugins.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js 18.x - 24.x**
- **npm 11+**

### Installation
```bash
# Clone the repository
git clone https://github.com/Loggableim/ltth_desktop2.git
cd ltth_desktop2

# Install dependencies
npm install
```

### Build Pipeline
We use a custom PowerShell script to manage the build process, including asset synchronization and native module compilation:

```powershell
# Clean and build the entire project
.\scripts\build.ps1 -Clean

# Build and run automated dashboard tests
.\scripts\build.ps1 -Clean -Test
```

### Running the App
```bash
# Standard Launch
npm run start:electron

# Headless mode (Background only)
.\node_modules\electron\dist\electron.exe . --headless
```

---

## 📦 Project Structure
- `source/main/`: Electron main process & Tray management.
- `source/backend/`: Express server, modules, and API routes.
- `dist/`: Compiled code and synchronized static assets.
- `bin/`: Final distributable binaries (e.g., `ltth.exe`).
- `scripts/`: Build and automation scripts.

---

## 🤖 Guidance for AI Agents
If you are an AI Coding Agent working on this repository, please consult [agent.md](agent.md) for critical architectural constraints and workflow rules.

---

## 📄 License
**CC BY-NC 4.0** - Creative Commons Attribution-NonCommercial 4.0 International.
See [LICENSE](LICENSE) for details.

---
**Made with ❤️ by PupCid & the LTTH Community**
**Version 1.3.3** - Modernized Release
