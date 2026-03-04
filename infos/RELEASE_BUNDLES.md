# Release Bundles

This document describes how prebuilt release bundles are built, structured, and consumed by the standalone launcher.

## Overview

Starting with the transition to prebuilt bundles, the standalone launcher downloads a ready-to-run application archive from GitHub Releases instead of cloning the repository and running `npm install` on the user's machine. This removes all end-user toolchain dependencies (Python, Visual C++ Build Tools, etc.) and avoids compilation of native modules like `better-sqlite3` at install time.

## Artifact Naming

| Platform   | Asset filename              |
|------------|-----------------------------|
| Windows x64 | `ltth-win-x64.zip`         |
| Linux x64   | `ltth-linux-x64.tar.gz`    |
| macOS       | `ltth-macos-x64.tar.gz`    |

A `checksums.txt` file is also published alongside the bundles and contains SHA256 hashes in standard `sha256sum` format:

```
<sha256hash>  ltth-win-x64.zip
<sha256hash>  ltth-linux-x64.tar.gz
<sha256hash>  ltth-macos-x64.tar.gz
```

## Bundle Contents

Each bundle contains a pre-installed `app/` directory:

```
ltth-win-x64.zip/
└── app/
    ├── server.js
    ├── launch.js
    ├── package.json
    ├── modules/
    ├── public/
    ├── plugins/
    └── node_modules/           ← pre-installed, includes:
        └── better-sqlite3/
            └── build/Release/
                └── better_sqlite3.node  ← pre-compiled for target platform
```

The `node_modules/` directory is fully populated and platform-specific native modules (like `better-sqlite3`) are pre-compiled for the target OS and architecture. No `npm install` or compilation step is required on the end-user machine.

## How the Launcher Selects and Verifies Assets

The standalone launcher (`standalonelauncher/standalone-launcher.go`) follows this flow on each run:

1. **Check for updates** via the GitHub Releases API (`/repos/{owner}/{repo}/releases/latest`).
2. **Version comparison**: if the installed version matches the latest release, skip download.
3. **Download prebuilt bundle** (preferred path):
   - Resolve the asset name for the current OS (`ltth-win-x64.zip` on Windows, etc.).
   - Locate the asset in the release's asset list; fail with a clear error if not found.
   - Download `checksums.txt` from the same release (non-fatal if absent).
   - Download the bundle with real-time progress (MB/s and ETA).
   - If a checksum was found, verify SHA256 before extraction.
   - Extract directly to the installation directory.
4. **Fallback – release source zip**: if no platform asset is found, fall back to downloading the repository zipball from the release (requires `npm install` on user machine).
5. **Fallback – branch zip**: if no release exists at all, download from the configured branch (also requires `npm install`).
6. **Detect prebuilt deps**: after extraction, check whether `app/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists.
7. **Skip npm install** if the prebuilt binary is present; otherwise run pre-flight checks and `npm install` (legacy path).
8. **Start the application** using the detected or installed Node.js runtime.

## Building Release Bundles (CI/CD)

Bundles are built and published automatically by the `.github/workflows/build-app-bundle.yml` workflow.

### Triggers

- **Tag push** matching `v*` (e.g., `v1.4.0`) – builds all platforms and publishes to GitHub Release.
- **`workflow_dispatch`** – manual trigger, builds all platforms and uploads as workflow artifacts (no release published).

### Build steps (per platform)

1. Checkout the repository.
2. Set up Node.js 20.
3. Run `npm ci --omit=dev --no-audit --no-fund` inside `./app/`.
4. Verify that `better_sqlite3.node` was compiled correctly.
5. Copy `app/` (with `node_modules/`) into a staging directory, removing test/docs artifacts.
6. Package into the platform-specific archive (`.zip` for Windows, `.tar.gz` for Linux/macOS).
7. Generate SHA256 checksum.
8. Upload as a workflow artifact.

The `publish-release` job (tag runs only) downloads all platform artifacts, merges the checksum files, and uploads everything to the GitHub Release via `softprops/action-gh-release`.

## Idempotent Installs

The launcher stores the installed release version in `version.json` next to the installation directory. On subsequent runs it compares this version with the latest GitHub release tag and skips the download if they match and `better_sqlite3.node` is present.

## Supported Platforms

| Platform    | Status   | Notes                                         |
|-------------|----------|-----------------------------------------------|
| Windows x64 | Required | Built on `windows-latest` runner              |
| Linux x64   | Included | Built on `ubuntu-latest` runner               |
| macOS       | Included | Built on `macos-latest` runner (universal ARM/x64 Node binary) |
