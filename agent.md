# 🤖 LTTH Agent Guide

This document provides essential context for AI Coding Agents working on the LTTH (Little TikTool Helper) project.

## 🏗️ Project Architecture
The project follows a modern **TypeScript-first** modular architecture:

- **Root**: Consolidated dependencies in `package.json`, build scripts in `scripts/`.
- **`source/main/`**: Electron main process logic, window management, and system tray.
- **`source/backend/`**: Express server, WebSocket communication, and core business logic.
- **`dist/`**: Target directory for compiled JavaScript and synchronized assets.
- **`bin/`**: Final distribution directory for the packaged `.exe`.

## 🛠️ Key Technologies
- **Electron**: Desktop shell.
- **Express / Socket.IO**: Real-time backend.
- **TypeScript**: Typed development across main and backend.
- **Better-SQLite3**: Local persistent storage (WAL mode).
- **Tailwind CSS**: Modern UI styling.

## 🚨 Critical Constraints
1. **Environment Variables**: Never persist `ELECTRON_RUN_AS_NODE=1` in the global environment. Use `$env:ELECTRON_RUN_AS_NODE=$null` before launching Electron to ensure GUI mode.
2. **Module Resolution**: Native modules (like `better-sqlite3`) must be resolved from the root `node_modules`. Use `source/backend/bootstrap.ts` for path patching.
3. **Build Pipeline**: Always use `.\scripts\build.ps1` for compilation. It handles asset synchronization (plugins, locales, tts, icons) which `tsc` lacks.
4. **Headless Mode**: Support the `--headless` flag in the main process to allow background operation with a tray-only interface.

## 📦 Dependency Management
- All dependencies are managed in the **root** `package.json`.
- Do **not** create nested `node_modules` in `source/backend/`.
- If native modules break, run `npm run rebuild` to trigger `@electron/rebuild`.

## 🧪 Testing & Verification
- Test critical UI paths using the local dev server at `http://localhost:3000`.
- Verify the distribution structure using `.\scripts\build.ps1 -Clean`.
- The final binary is always produced at `bin/ltth.exe`.
