package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDefaultInstallDirUsesLocalAppDataOnWindows(t *testing.T) {
	env := map[string]string{
		"LOCALAPPDATA": filepath.Join(`C:\Users`, "tester", "AppData", "Local"),
	}

	got := defaultInstallDir("windows", filepath.Join(`C:\Users`, "tester"), env)
	want := filepath.Join(env["LOCALAPPDATA"], "LTTH")
	if got != want {
		t.Fatalf("defaultInstallDir() = %q, want %q", got, want)
	}
}

func TestSelectPayloadChoosesMatchingPlatformAndArch(t *testing.T) {
	manifest := ReleaseManifest{
		Version: "1.4.0",
		Channel: channelStable,
		Payloads: []PayloadDescriptor{
			{
				Platform:            "darwin",
				Arch:                "arm64",
				PayloadURL:          "https://example.invalid/ltth-payload-darwin-arm64-1.4.0.tar.gz",
				PayloadSHA256:       strings.Repeat("a", 64),
				PayloadSize:         42,
				MinBootstrapVersion: "0.1.0",
				ArchiveFormat:       archiveFormatTarGz,
			},
			{
				Platform:            "windows",
				Arch:                "amd64",
				PayloadURL:          "https://example.invalid/ltth-payload-windows-amd64-1.4.0.zip",
				PayloadSHA256:       strings.Repeat("b", 64),
				PayloadSize:         84,
				MinBootstrapVersion: "0.1.0",
				ArchiveFormat:       archiveFormatZip,
			},
		},
	}

	payload, err := selectPayload(manifest, "windows", "amd64")
	if err != nil {
		t.Fatalf("selectPayload() returned error: %v", err)
	}
	if payload.Platform != "windows" || payload.Arch != "amd64" {
		t.Fatalf("unexpected payload returned: %#v", payload)
	}
}

func TestSelectPayloadRejectsInvalidManifestEntry(t *testing.T) {
	manifest := ReleaseManifest{
		Version: "1.4.0",
		Channel: channelStable,
		Payloads: []PayloadDescriptor{
			{
				Platform: "windows",
				Arch:     "amd64",
			},
		},
	}

	if _, err := selectPayload(manifest, "windows", "amd64"); err == nil {
		t.Fatal("selectPayload() should reject incomplete payload descriptors")
	}
}

func TestInstallPayloadArchiveActivatesPayloadAtomically(t *testing.T) {
	installRoot := t.TempDir()
	archivePath := filepath.Join(t.TempDir(), "payload.zip")
	files := map[string]string{
		"launcher.exe":          "launcher",
		"app/package.json":      `{"name":"ltth"}`,
		"assets/launcher.html":  "<html></html>",
		"locales/de.json":       `{"app_name":"LTTH"}`,
		"runtime/node/node.exe": "node",
	}
	createPayloadZip(t, archivePath, files)

	if err := installPayloadArchive(archivePath, installRoot, "windows", PayloadDescriptor{}); err != nil {
		t.Fatalf("installPayloadArchive() returned error: %v", err)
	}

	for _, relPath := range []string{
		"current/launcher.exe",
		"current/app/package.json",
		"current/assets/launcher.html",
		"current/locales/de.json",
		"current/runtime/node/node.exe",
	} {
		if _, err := os.Stat(filepath.Join(installRoot, relPath)); err != nil {
			t.Fatalf("expected %s to exist after install: %v", relPath, err)
		}
	}
}

func TestInstallPayloadArchiveRollsBackIfPayloadIsInvalid(t *testing.T) {
	installRoot := t.TempDir()
	currentDir := filepath.Join(installRoot, "current")
	if err := os.MkdirAll(currentDir, 0755); err != nil {
		t.Fatalf("failed to create current dir: %v", err)
	}
	markerPath := filepath.Join(currentDir, "marker.txt")
	if err := os.WriteFile(markerPath, []byte("keep-me"), 0644); err != nil {
		t.Fatalf("failed to create marker file: %v", err)
	}

	archivePath := filepath.Join(t.TempDir(), "bad-payload.zip")
	createPayloadZip(t, archivePath, map[string]string{
		"app/package.json": `{"name":"ltth"}`,
	})

	if err := installPayloadArchive(archivePath, installRoot, "windows", PayloadDescriptor{}); err == nil {
		t.Fatal("installPayloadArchive() should fail for an invalid payload")
	}

	data, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("expected previous payload marker to survive failed install: %v", err)
	}
	if string(data) != "keep-me" {
		t.Fatalf("unexpected marker content after rollback: %q", string(data))
	}
}

func TestInstallPayloadArchiveRollsBackIfSignedPayloadFailsTrustCheck(t *testing.T) {
	installRoot := t.TempDir()
	currentDir := filepath.Join(installRoot, "current")
	if err := os.MkdirAll(currentDir, 0755); err != nil {
		t.Fatalf("failed to create current dir: %v", err)
	}
	markerPath := filepath.Join(currentDir, "marker.txt")
	if err := os.WriteFile(markerPath, []byte("keep-me"), 0644); err != nil {
		t.Fatalf("failed to create marker file: %v", err)
	}

	archivePath := filepath.Join(t.TempDir(), "signed-payload.zip")
	createPayloadZip(t, archivePath, map[string]string{
		"launcher.exe":          "launcher",
		"app/package.json":      `{"name":"ltth"}`,
		"assets/launcher.html":  "<html></html>",
		"locales/de.json":       `{"app_name":"LTTH"}`,
		"runtime/node/node.exe": "node",
	})

	oldVerify := verifyExecutableSignatureFunc
	verifyExecutableSignatureFunc = func(string) error {
		return os.ErrPermission
	}
	defer func() {
		verifyExecutableSignatureFunc = oldVerify
	}()

	if err := installPayloadArchive(archivePath, installRoot, "windows", PayloadDescriptor{Signed: true}); err == nil {
		t.Fatal("installPayloadArchive() should fail when trust verification fails")
	}

	data, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("expected previous payload marker to survive failed trust verification: %v", err)
	}
	if string(data) != "keep-me" {
		t.Fatalf("unexpected marker content after trust rollback: %q", string(data))
	}
}

func TestInstalledReleaseStatePersistsUnderRuntime(t *testing.T) {
	installRoot := t.TempDir()
	state := InstalledReleaseState{
		Version:     "1.4.0",
		Channel:     channelStable,
		Platform:    "windows",
		Arch:        "amd64",
		InstallDir:  installRoot,
		CurrentPath: filepath.Join(installRoot, "current"),
	}

	if err := writeInstalledReleaseState(installRoot, state); err != nil {
		t.Fatalf("writeInstalledReleaseState() returned error: %v", err)
	}

	raw, err := os.ReadFile(installedReleaseStatePath(installRoot))
	if err != nil {
		t.Fatalf("failed to read installed release state: %v", err)
	}

	var saved InstalledReleaseState
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatalf("installed release state should be valid JSON: %v", err)
	}
	if saved.CurrentPath != state.CurrentPath {
		t.Fatalf("saved state mismatch: %#v", saved)
	}
	if !strings.Contains(installedReleaseStatePath(installRoot), filepath.Join("runtime", "installed-release.json")) {
		t.Fatalf("state file should live under runtime/: %s", installedReleaseStatePath(installRoot))
	}
}

func TestDetectLegacyInstallPrefersProgramFilesLTTHOnWindows(t *testing.T) {
	programFilesRoot := filepath.Join(t.TempDir(), "Program Files")
	env := map[string]string{
		"ProgramFiles": programFilesRoot,
	}
	legacyRoot := filepath.Join(env["ProgramFiles"], "LTTH")
	if err := os.MkdirAll(filepath.Join(legacyRoot, "app"), 0755); err != nil {
		t.Fatalf("failed to create legacy app dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyRoot, "launcher.exe"), []byte("launcher"), 0644); err != nil {
		t.Fatalf("failed to create legacy launcher: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyRoot, "app", "package.json"), []byte(`{"name":"ltth"}`), 0644); err != nil {
		t.Fatalf("failed to create legacy package: %v", err)
	}

	got := detectLegacyInstall("windows", env, []string{legacyRoot})
	if got != legacyRoot {
		t.Fatalf("detectLegacyInstall() = %q, want %q", got, legacyRoot)
	}
}

func TestMigrateLegacyInstallCopiesExpectedLauncherAssets(t *testing.T) {
	legacyRoot := filepath.Join(t.TempDir(), "legacy")
	if err := os.MkdirAll(filepath.Join(legacyRoot, "app"), 0755); err != nil {
		t.Fatalf("failed to create legacy app dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(legacyRoot, "assets"), 0755); err != nil {
		t.Fatalf("failed to create legacy assets dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(legacyRoot, "locales"), 0755); err != nil {
		t.Fatalf("failed to create legacy locales dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(legacyRoot, "runtime", "node"), 0755); err != nil {
		t.Fatalf("failed to create legacy runtime dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyRoot, "launcher.exe"), []byte("launcher"), 0644); err != nil {
		t.Fatalf("failed to create legacy launcher: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyRoot, "icon.ico"), []byte("icon"), 0644); err != nil {
		t.Fatalf("failed to create legacy icon: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyRoot, "app", "package.json"), []byte(`{"name":"ltth"}`), 0644); err != nil {
		t.Fatalf("failed to create legacy package: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyRoot, "assets", "launcher.html"), []byte("<html></html>"), 0644); err != nil {
		t.Fatalf("failed to create legacy launcher html: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyRoot, "locales", "de.json"), []byte(`{"app_name":"LTTH"}`), 0644); err != nil {
		t.Fatalf("failed to create legacy locale: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyRoot, "runtime", "node", "node.exe"), []byte("node"), 0644); err != nil {
		t.Fatalf("failed to create legacy node runtime: %v", err)
	}

	installRoot := t.TempDir()
	if err := migrateLegacyInstall(legacyRoot, installRoot); err != nil {
		t.Fatalf("migrateLegacyInstall() returned error: %v", err)
	}

	for _, relPath := range []string{
		"current/launcher.exe",
		"current/icon.ico",
		"current/app/package.json",
		"current/assets/launcher.html",
		"current/locales/de.json",
	} {
		if _, err := os.Stat(filepath.Join(installRoot, relPath)); err != nil {
			t.Fatalf("expected migrated file %s to exist: %v", relPath, err)
		}
	}
}

func TestRunInstallDownloadsManifestAndActivatesPayload(t *testing.T) {
	installRoot := t.TempDir()
	payloadArchive := filepath.Join(t.TempDir(), "payload.zip")
	payloadFiles := map[string]string{
		"launcher.exe":          "launcher",
		"icon.ico":              "icon",
		"app/package.json":      `{"name":"ltth"}`,
		"assets/launcher.html":  "<html></html>",
		"locales/de.json":       `{"app_name":"LTTH"}`,
		"runtime/node/node.exe": "node",
	}
	createPayloadZip(t, payloadArchive, payloadFiles)

	payloadBytes, err := os.ReadFile(payloadArchive)
	if err != nil {
		t.Fatalf("failed to read payload archive: %v", err)
	}
	payloadSHA := sha256.Sum256(payloadBytes)
	payloadSHAHex := hex.EncodeToString(payloadSHA[:])

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/stable.json":
			_ = json.NewEncoder(w).Encode(ReleaseManifest{
				Version: "1.4.0",
				Channel: channelStable,
				Payloads: []PayloadDescriptor{
					{
						Platform:            runtime.GOOS,
						Arch:                normalizeArch(runtime.GOARCH),
						PayloadURL:          server.URL + "/payload.zip",
						PayloadSHA256:       payloadSHAHex,
						PayloadSize:         int64(len(payloadBytes)),
						MinBootstrapVersion: "0.1.0",
						ArchiveFormat:       archiveFormatZip,
					},
				},
			})
		case "/payload.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(payloadBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	bootstrapper := newBootstrapper()
	bootstrapper.config.InstallDir = installRoot
	bootstrapper.config.Channel = channelStable
	bootstrapper.config.ManifestURL = server.URL + "/stable.json"

	oldCreateShortcuts := createPlatformShortcutsFunc
	oldStartInstalledApp := startInstalledAppFunc
	createPlatformShortcutsFunc = func(string) error { return nil }
	startInstalledAppFunc = func(string) error { return nil }
	defer func() {
		createPlatformShortcutsFunc = oldCreateShortcuts
		startInstalledAppFunc = oldStartInstalledApp
	}()

	bootstrapper.runInstall()

	if !bootstrapper.status.Installed {
		t.Fatalf("expected installed status, got %#v", bootstrapper.status)
	}
	if bootstrapper.status.Version != "1.4.0" {
		t.Fatalf("unexpected installed version: %#v", bootstrapper.status)
	}
	if _, err := os.Stat(filepath.Join(installRoot, "current", "app", "package.json")); err != nil {
		t.Fatalf("expected payload app files to exist: %v", err)
	}
	state, err := loadInstalledReleaseState(installRoot)
	if err != nil {
		t.Fatalf("expected installed release state to exist: %v", err)
	}
	if state.Version != "1.4.0" || state.Channel != channelStable {
		t.Fatalf("unexpected installed release state: %#v", state)
	}
}

func TestPayloadPackagingExcludesRuntimeAndUserDataPaths(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("payload-app-excludes.json"))
	if err != nil {
		t.Fatalf("failed to read payload excludes file: %v", err)
	}

	var payload struct {
		Paths []string `json:"paths"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("payload excludes file should be valid json: %v", err)
	}

	expected := []string{
		".env",
		"coverage",
		"logs",
		"test",
		"user_configs",
		"user_data",
		"test_user_configs",
		".codex-server-logs",
	}
	for _, required := range expected {
		if !containsString(payload.Paths, required) {
			t.Fatalf("payload excludes should contain %q, got %#v", required, payload.Paths)
		}
	}

	scriptRaw, err := os.ReadFile(filepath.Join("scripts", "package-windows-bootstrap-release.ps1"))
	if err != nil {
		t.Fatalf("failed to read packaging script: %v", err)
	}
	if !strings.Contains(string(scriptRaw), "payload-app-excludes.json") {
		t.Fatal("packaging script should load payload-app-excludes.json")
	}
}

func TestPackagingScriptSupportsSignedManifestFlag(t *testing.T) {
	scriptRaw, err := os.ReadFile(filepath.Join("scripts", "package-windows-bootstrap-release.ps1"))
	if err != nil {
		t.Fatalf("failed to read packaging script: %v", err)
	}
	script := string(scriptRaw)
	if !strings.Contains(script, "[switch]$PayloadSigned") {
		t.Fatal("packaging script should expose a PayloadSigned switch")
	}
	if !strings.Contains(script, "signed = [bool]$PayloadSigned") {
		t.Fatal("packaging script should project PayloadSigned into the manifest")
	}
}

func TestFetchManifestResolvesRelativePayloadAndSignatureURLs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/manifests/stable.json" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(ReleaseManifest{
			Version: "1.4.0",
			Channel: channelStable,
			Payloads: []PayloadDescriptor{
				{
					Platform:            "windows",
					Arch:                "amd64",
					PayloadURL:          "../payloads/ltth-payload-windows-amd64-1.4.0.zip",
					SignatureURL:        "../payloads/ltth-payload-windows-amd64-1.4.0.zip.sig",
					PayloadSHA256:       strings.Repeat("c", 64),
					PayloadSize:         123,
					MinBootstrapVersion: "0.1.0",
					ArchiveFormat:       archiveFormatZip,
					Signed:              true,
				},
			},
		})
	}))
	defer server.Close()

	manifest, err := fetchManifest(server.URL + "/manifests/stable.json")
	if err != nil {
		t.Fatalf("fetchManifest() returned error: %v", err)
	}

	if len(manifest.Payloads) != 1 {
		t.Fatalf("expected one payload, got %#v", manifest.Payloads)
	}
	payload := manifest.Payloads[0]
	if payload.PayloadURL != server.URL+"/payloads/ltth-payload-windows-amd64-1.4.0.zip" {
		t.Fatalf("unexpected resolved payload URL: %q", payload.PayloadURL)
	}
	if payload.SignatureURL != server.URL+"/payloads/ltth-payload-windows-amd64-1.4.0.zip.sig" {
		t.Fatalf("unexpected resolved signature URL: %q", payload.SignatureURL)
	}
}

func createPayloadZip(t *testing.T, archivePath string, files map[string]string) {
	t.Helper()

	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("failed to create zip file: %v", err)
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	for relPath, content := range files {
		entry, err := writer.Create(relPath)
		if err != nil {
			t.Fatalf("failed to create zip entry %s: %v", relPath, err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("failed to write zip entry %s: %v", relPath, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("failed to close zip writer: %v", err)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
