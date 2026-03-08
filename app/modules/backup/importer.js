'use strict';

/**
 * Backup importer – reads a ZIP archive produced by the exporter and restores
 * configuration into the running installation.
 *
 * Supports:
 *  - dry-run (preview) mode that returns a structured report without writing anything
 *  - merge mode  – only write settings/files that don't already exist
 *  - replace mode – overwrite everything
 *  - selective restore – caller can limit which plugins / sections to import
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zl = require('zip-lib');
const { validateManifest } = require('./manifest');
const { validateBackupSize, validateEntryPath, validateDestinationPath, sanitisePluginId, MAX_BACKUP_SIZE_BYTES } = require('./validators');
const { discoverAllPluginSettings, discoverGlobalSettings, restorePluginSettings, restoreGlobalSettings } = require('./plugin-discovery');
const { detectPluginConflicts, detectSettingsConflicts } = require('./conflict-resolver');

/**
 * Parse a backup ZIP from a file path on disk.
 *
 * @param {string} zipPath - Absolute path to the uploaded ZIP file
 * @param {number} [fileSizeBytes] - Pre-computed file size for size validation
 * @returns {Promise<{ manifest: object, globalSettings: object|null, pluginSettings: object, dataFiles: object, warnings: string[], errors: string[] }>}
 */
async function parseBackupZip(zipPath, fileSizeBytes) {
    const warnings = [];
    const errors = [];

    // Size check
    if (fileSizeBytes !== undefined) {
        const sizeCheck = validateBackupSize(fileSizeBytes);
        if (!sizeCheck.valid) {
            return { manifest: null, globalSettings: null, pluginSettings: {}, dataFiles: {}, warnings, errors: [sizeCheck.error] };
        }
    }

    // Extract to a temp directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltth-backup-'));
    try {
        await zl.extract(zipPath, tmpDir);
    } catch (err) {
        cleanupTempDir(tmpDir);
        return { manifest: null, globalSettings: null, pluginSettings: {}, dataFiles: {}, warnings, errors: [`Failed to extract backup archive: ${err.message}`] };
    }

    // ── Read manifest ─────────────────────────────────────────────────────────
    const manifestPath = path.join(tmpDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        cleanupTempDir(tmpDir);
        return { manifest: null, globalSettings: null, pluginSettings: {}, dataFiles: {}, warnings, errors: ['Invalid backup: manifest.json not found'] };
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
        cleanupTempDir(tmpDir);
        return { manifest: null, globalSettings: null, pluginSettings: {}, dataFiles: {}, warnings, errors: [`Failed to parse manifest.json: ${err.message}`] };
    }

    const manifestValidation = validateManifest(manifest);
    if (!manifestValidation.valid) {
        cleanupTempDir(tmpDir);
        return { manifest, globalSettings: null, pluginSettings: {}, dataFiles: {}, warnings, errors: manifestValidation.errors };
    }
    warnings.push(...(manifest.warnings || []).map(w => `[original export] ${w}`));

    // ── Read global settings ──────────────────────────────────────────────────
    let globalSettings = null;
    const globalSettingsPath = path.join(tmpDir, 'global', 'settings.json');
    if (fs.existsSync(globalSettingsPath)) {
        try {
            globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
        } catch (err) {
            warnings.push(`Failed to parse global/settings.json: ${err.message}`);
        }
    }

    // ── Read per-plugin settings ──────────────────────────────────────────────
    const pluginSettings = {};
    const pluginsDir = path.join(tmpDir, 'plugins');

    if (fs.existsSync(pluginsDir)) {
        const pluginEntries = fs.readdirSync(pluginsDir, { withFileTypes: true })
            .filter(e => e.isDirectory());

        for (const entry of pluginEntries) {
            const pluginId = sanitisePluginId(entry.name);
            if (!pluginId) {
                warnings.push(`Skipping plugin directory with unsafe name: ${entry.name}`);
                continue;
            }

            const settingsFile = path.join(pluginsDir, entry.name, 'settings.json');
            if (fs.existsSync(settingsFile)) {
                try {
                    pluginSettings[pluginId] = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
                } catch (err) {
                    warnings.push(`Failed to parse settings for plugin ${pluginId}: ${err.message}`);
                }
            }
        }
    }

    // ── Collect data files (keep as temp paths for now) ───────────────────────
    // dataFiles: pluginId → Array<{ tmpPath, relPath }>
    const dataFiles = {};

    if (fs.existsSync(pluginsDir)) {
        const pluginEntries = fs.readdirSync(pluginsDir, { withFileTypes: true })
            .filter(e => e.isDirectory());

        for (const entry of pluginEntries) {
            const pluginId = sanitisePluginId(entry.name);
            if (!pluginId) continue;

            const dataDir = path.join(pluginsDir, entry.name, 'data');
            if (!fs.existsSync(dataDir)) continue;

            const files = walkDir(dataDir);
            dataFiles[pluginId] = files.map(absPath => {
                const relPath = path.relative(dataDir, absPath);
                return { tmpPath: absPath, relPath };
            });
        }
    }

    // ── Collect upload / user_data file paths ─────────────────────────────────
    const uploadFiles = [];
    const uploadsDir = path.join(tmpDir, 'uploads');
    if (fs.existsSync(uploadsDir)) {
        walkDir(uploadsDir).forEach(absPath => {
            uploadFiles.push({ tmpPath: absPath, relPath: path.relative(uploadsDir, absPath) });
        });
    }

    const userDataFiles = [];
    const userDataDir = path.join(tmpDir, 'user_data');
    if (fs.existsSync(userDataDir)) {
        walkDir(userDataDir).forEach(absPath => {
            userDataFiles.push({ tmpPath: absPath, relPath: path.relative(userDataDir, absPath) });
        });
    }

    return {
        manifest,
        globalSettings,
        pluginSettings,
        dataFiles,
        uploadFiles,
        userDataFiles,
        tmpDir,     // Caller must clean up
        warnings,
        errors
    };
}

/**
 * Generate a dry-run preview of what would be imported.
 *
 * @param {object} parsed      - Result of parseBackupZip
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {object} [opts]
 * @param {string[]} [opts.pluginFilter] - Only preview these plugin IDs
 * @returns {object} Preview report
 */
function previewImport(parsed, deps, opts = {}) {
    const { db } = deps;
    const { pluginFilter } = opts;

    const currentGlobal = discoverGlobalSettings(db);
    const currentPlugins = discoverAllPluginSettings(db);

    const globalConflicts = parsed.globalSettings
        ? detectSettingsConflicts(parsed.globalSettings, currentGlobal)
        : { new: [], conflicts: [], unchanged: [] };

    const allPluginIds = Object.keys(parsed.pluginSettings);
    const selectedPluginIds = pluginFilter
        ? allPluginIds.filter(id => pluginFilter.includes(id))
        : allPluginIds;

    const pluginConflicts = detectPluginConflicts(
        Object.fromEntries(selectedPluginIds.map(id => [id, parsed.pluginSettings[id] || {}])),
        currentPlugins
    );

    const dataFileSummary = {};
    for (const pluginId of selectedPluginIds) {
        const files = parsed.dataFiles[pluginId] || [];
        dataFileSummary[pluginId] = files.length;
    }

    return {
        manifest: parsed.manifest,
        warnings: parsed.warnings,
        global: {
            new: globalConflicts.new.length,
            conflicts: globalConflicts.conflicts.length,
            unchanged: globalConflicts.unchanged.length,
            conflictKeys: globalConflicts.conflicts
        },
        plugins: Object.fromEntries(
            selectedPluginIds.map(id => [
                id,
                {
                    settingsNew: (pluginConflicts[id] || {}).new?.length || 0,
                    settingsConflicts: (pluginConflicts[id] || {}).conflicts?.length || 0,
                    settingsUnchanged: (pluginConflicts[id] || {}).unchanged?.length || 0,
                    conflictKeys: (pluginConflicts[id] || {}).conflicts || [],
                    dataFiles: dataFileSummary[id] || 0
                }
            ])
        ),
        uploadFiles: (parsed.uploadFiles || []).length,
        userDataFiles: (parsed.userDataFiles || []).length
    };
}

/**
 * Perform the actual import.
 *
 * @param {object} parsed      - Result of parseBackupZip
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {import('../config-path-manager')} deps.configPathManager
 * @param {object} [deps.backupProviders] - Map<pluginId, provider>
 * @param {object} opts
 * @param {'merge'|'replace'} [opts.mode='merge']
 * @param {boolean} [opts.includeGlobalSettings=true]
 * @param {boolean} [opts.includePluginSettings=true]
 * @param {boolean} [opts.includePluginData=true]
 * @param {boolean} [opts.includeUploads=false]
 * @param {boolean} [opts.includeUserData=false]
 * @param {string[]} [opts.pluginFilter] - Only restore these plugin IDs
 * @returns {Promise<{ success: boolean, report: object, warnings: string[], errors: string[] }>}
 */
async function performImport(parsed, deps, opts = {}) {
    const { db, configPathManager, backupProviders = {} } = deps;
    const {
        mode = 'merge',
        includeGlobalSettings = true,
        includePluginSettings = true,
        includePluginData = true,
        includeUploads = false,
        includeUserData = false,
        pluginFilter = null
    } = opts;

    const warnings = [...(parsed.warnings || [])];
    const errors = [];
    const report = {
        globalSettings: { imported: [], skipped: [] },
        plugins: {}
    };

    // ── Global settings ───────────────────────────────────────────────────────
    if (includeGlobalSettings && parsed.globalSettings) {
        try {
            const result = restoreGlobalSettings(db, parsed.globalSettings, mode);
            report.globalSettings = result;
        } catch (err) {
            errors.push(`Failed to restore global settings: ${err.message}`);
        }
    }

    // ── Plugin settings ───────────────────────────────────────────────────────
    const allPluginIds = Object.keys(parsed.pluginSettings || {});
    const selectedPluginIds = pluginFilter
        ? allPluginIds.filter(id => pluginFilter.includes(id))
        : allPluginIds;

    for (const pluginId of selectedPluginIds) {
        report.plugins[pluginId] = { importedSettings: [], skippedSettings: [], importedFiles: [], skippedFiles: [] };

        // Try custom provider
        const provider = backupProviders[pluginId];
        if (provider && typeof provider.importConfig === 'function' && includePluginSettings) {
            try {
                const customResult = await provider.importConfig({
                    settings: parsed.pluginSettings[pluginId] || {},
                    mode
                });
                if (customResult.warnings) warnings.push(...customResult.warnings.map(w => `[${pluginId}] ${w}`));
                if (customResult.importedKeys) report.plugins[pluginId].importedSettings = customResult.importedKeys;
            } catch (err) {
                warnings.push(`Custom import failed for plugin ${pluginId}, using generic fallback: ${err.message}`);
                // Fall through to generic import
                if (includePluginSettings && parsed.pluginSettings[pluginId]) {
                    const result = restorePluginSettings(db, pluginId, parsed.pluginSettings[pluginId], mode);
                    report.plugins[pluginId].importedSettings = result.imported;
                    report.plugins[pluginId].skippedSettings = result.skipped;
                }
            }
        } else if (includePluginSettings && parsed.pluginSettings[pluginId]) {
            const result = restorePluginSettings(db, pluginId, parsed.pluginSettings[pluginId], mode);
            report.plugins[pluginId].importedSettings = result.imported;
            report.plugins[pluginId].skippedSettings = result.skipped;
        }

        // Plugin data files
        if (includePluginData && parsed.dataFiles && parsed.dataFiles[pluginId]) {
            const destBase = configPathManager.getPluginDataDir(pluginId);

            for (const { tmpPath, relPath } of parsed.dataFiles[pluginId]) {
                // Path traversal check
                const pathCheck = validateEntryPath(relPath);
                if (!pathCheck.valid) {
                    warnings.push(`[${pluginId}] Skipping file with unsafe path: ${relPath}`);
                    report.plugins[pluginId].skippedFiles.push(relPath);
                    continue;
                }

                const destPath = path.join(destBase, relPath);
                const destCheck = validateDestinationPath(destPath, destBase);
                if (!destCheck.valid) {
                    warnings.push(`[${pluginId}] Skipping file, ${destCheck.error}`);
                    report.plugins[pluginId].skippedFiles.push(relPath);
                    continue;
                }

                // In merge mode, skip existing files
                if (mode === 'merge' && fs.existsSync(destPath)) {
                    report.plugins[pluginId].skippedFiles.push(relPath);
                    continue;
                }

                try {
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    fs.copyFileSync(tmpPath, destPath);
                    report.plugins[pluginId].importedFiles.push(relPath);
                } catch (err) {
                    warnings.push(`[${pluginId}] Failed to restore file ${relPath}: ${err.message}`);
                    report.plugins[pluginId].skippedFiles.push(relPath);
                }
            }
        }
    }

    // ── Uploads ───────────────────────────────────────────────────────────────
    if (includeUploads && parsed.uploadFiles && parsed.uploadFiles.length > 0) {
        const uploadsBase = configPathManager.getUploadsDir();
        report.uploads = { imported: [], skipped: [] };

        for (const { tmpPath, relPath } of parsed.uploadFiles) {
            const pathCheck = validateEntryPath(relPath);
            if (!pathCheck.valid) {
                warnings.push(`[uploads] Skipping file with unsafe path: ${relPath}`);
                report.uploads.skipped.push(relPath);
                continue;
            }

            const destPath = path.join(uploadsBase, relPath);
            const destCheck = validateDestinationPath(destPath, uploadsBase);
            if (!destCheck.valid) {
                warnings.push(`[uploads] Skipping file, ${destCheck.error}`);
                report.uploads.skipped.push(relPath);
                continue;
            }

            if (mode === 'merge' && fs.existsSync(destPath)) {
                report.uploads.skipped.push(relPath);
                continue;
            }

            try {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.copyFileSync(tmpPath, destPath);
                report.uploads.imported.push(relPath);
            } catch (err) {
                warnings.push(`[uploads] Failed to restore ${relPath}: ${err.message}`);
                report.uploads.skipped.push(relPath);
            }
        }
    }

    // ── User data ─────────────────────────────────────────────────────────────
    if (includeUserData && parsed.userDataFiles && parsed.userDataFiles.length > 0) {
        const userDataBase = configPathManager.getUserDataDir();
        report.userData = { imported: [], skipped: [] };

        for (const { tmpPath, relPath } of parsed.userDataFiles) {
            const pathCheck = validateEntryPath(relPath);
            if (!pathCheck.valid) {
                warnings.push(`[user_data] Skipping file with unsafe path: ${relPath}`);
                report.userData.skipped.push(relPath);
                continue;
            }

            const destPath = path.join(userDataBase, relPath);
            const destCheck = validateDestinationPath(destPath, userDataBase);
            if (!destCheck.valid) {
                warnings.push(`[user_data] Skipping file, ${destCheck.error}`);
                report.userData.skipped.push(relPath);
                continue;
            }

            if (mode === 'merge' && fs.existsSync(destPath)) {
                report.userData.skipped.push(relPath);
                continue;
            }

            try {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.copyFileSync(tmpPath, destPath);
                report.userData.imported.push(relPath);
            } catch (err) {
                warnings.push(`[user_data] Failed to restore ${relPath}: ${err.message}`);
                report.userData.skipped.push(relPath);
            }
        }
    }

    return {
        success: errors.length === 0,
        report,
        warnings,
        errors
    };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Recursively walk a directory and return absolute file paths.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walkDir(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDir(full));
        } else if (entry.isFile()) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Remove a temporary directory created during import parsing.
 *
 * @param {string} tmpDir
 */
function cleanupTempDir(tmpDir) {
    try {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    } catch {
        // best effort
    }
}

module.exports = { parseBackupZip, previewImport, performImport, cleanupTempDir };
