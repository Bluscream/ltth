/**
 * LTTH Electron - Root Entry Point
 * 
 * This is the main process for the Electron application.
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron';
import * as path from 'path';

console.log('Process type:', process.type);
console.log('ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE);
console.log('Electron module exports:', typeof require('electron') === 'string' ? require('electron') : Object.keys(require('electron')));
if (!app) {
    console.error('CRITICAL: app is undefined!');
}

// Connect our bootstrap configuration first
import '../backend/bootstrap';

// Define typed updater configuration, deferring instantiation where possible
let autoUpdater: any;
try {
    const electronUpdater = require('electron-updater');
    autoUpdater = electronUpdater.autoUpdater;
} catch (e) {
    console.warn("electron-updater not available in this environment");
}

// Global references to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayContextMenu: Menu | null = null;

// Configuration
const PORT = parseInt(process.env.PORT || '3000', 10);
const isDev = !app.isPackaged;
// Force unset ELECTRON_RUN_AS_NODE if it somehow made it into this process
if (process.env.ELECTRON_RUN_AS_NODE) {
    console.warn('[ELECTRON MAIN] Detected ELECTRON_RUN_AS_NODE=1. Forcefully unsetting for future spawns.');
    delete process.env.ELECTRON_RUN_AS_NODE;
}

const isHeadless = process.argv.includes('--headless');

// ========== ELECTRON WINDOW MANAGEMENT ==========
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        icon: path.join(__dirname, 'build/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '..', 'backend', 'preload.js') // We'll assume a preload.js exists or will exist
        },
        show: false, // Don't show until ready
        backgroundColor: '#1a1a1a'
    });

    // Load the app served by our backend
    mainWindow.loadURL(`http://localhost:${PORT}`);

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        if (!app.getLoginItemSettings().wasOpenedAtLogin && !isHeadless) {
            mainWindow?.show();
        }
    });

    // Handle window close (minimize to tray instead)
    mainWindow.on('close', (event) => {
        if (!(app as any).isQuitting) {
            event.preventDefault();
            mainWindow?.hide();

            // Show notification
            if (tray) {
                tray.displayBalloon({
                    title: 'LTTH Desktop',
                    content: 'App minimized to tray. Right-click tray icon to quit.'
                });
            }
        }
        return false;
    });

    // Open DevTools in development
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ========== SYSTEM TRAY ==========
function createTray() {
    try {
        // Create tray icon
        const iconPath = path.join(__dirname, 'build/tray-icon.png');
        if (require('fs').existsSync(iconPath)) {
            const trayIcon = nativeImage.createFromPath(iconPath);
            tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
            
            // Create context menu
            trayContextMenu = Menu.buildFromTemplate([
                {
                    label: 'LTTH Desktop',
                    enabled: false,
                    icon: trayIcon.resize({ width: 16, height: 16 })
                },
                { type: 'separator' },
                {
                    label: 'Show Window',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.show();
                            mainWindow.focus();
                        } else {
                            createWindow();
                            mainWindow?.once('ready-to-show', () => {
                                mainWindow?.show();
                            });
                        }
                    }
                },
                {
                    label: 'Connection Status',
                    submenu: [
                        {
                            label: 'Disconnected',
                            enabled: false,
                            id: 'connection-status'
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Auto-Start on Boot',
                    type: 'checkbox',
                    checked: app.getLoginItemSettings().openAtLogin,
                    click: (menuItem) => {
                        app.setLoginItemSettings({
                            openAtLogin: menuItem.checked,
                            openAsHidden: true
                        });
                    }
                },
                { type: 'separator' },
                {
                    label: 'Check for Updates',
                    click: () => {
                        checkForUpdates();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    click: () => {
                        (app as any).isQuitting = true;
                        app.quit();
                    }
                }
            ]);

            tray.setToolTip('LTTH Desktop');
            tray.setContextMenu(trayContextMenu);

            // Double-click to show window
            tray.on('double-click', () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                } else {
                    createWindow();
                    mainWindow?.once('ready-to-show', () => {
                        mainWindow?.show();
                    });
                }
            });
        } else {
            console.warn('[TRAY] Tray icon not found at', iconPath);
        }
    } catch (err) {
        console.error('[TRAY] Failed to create tray', err);
    }
}

// Update tray connection status (callable via IPC or Socket in future)
export function updateTrayStatus(connected: boolean, username: string = '') {
    if (!tray || !trayContextMenu) return;

    const statusItem = trayContextMenu.getMenuItemById('connection-status');
    if (statusItem) {
        statusItem.label = connected
            ? `✅ Connected to @${username}`
            : '❌ Disconnected';
        tray.setContextMenu(trayContextMenu);
    }
}

// ========== AUTO-UPDATER ==========
function setupAutoUpdater() {
    if (!autoUpdater) return;

    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info: any) => {
        if (!mainWindow) return;
        (dialog.showMessageBox as any)(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `Version ${info.version} is available. Download now?`,
            buttons: ['Download', 'Later']
        }).then((result: any) => {
            const response = result.response !== undefined ? result.response : result;
            if (response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
    });

    autoUpdater.on('update-downloaded', (info: any) => {
        if (!mainWindow) return;
        (dialog.showMessageBox as any)(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded. Restart now to install?',
            buttons: ['Restart', 'Later']
        }).then((result: any) => {
            const response = result.response !== undefined ? result.response : result;
            if (response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    });

    autoUpdater.on('error', (error: any) => {
        console.error('Auto-updater error:', error);
    });
}

function checkForUpdates() {
    if (autoUpdater) {
        autoUpdater.checkForUpdates().catch((error: any) => {
            console.error('Update check failed:', error);
        });
    }
}

// ========== APP LIFECYCLE ==========
app.on('ready', async () => {
    console.log('[ELECTRON] Booting Express App...');
    // Boot the Express App Server
    // This runs `source/backend/server.ts` which automatically binds to the port
    require('../backend/server');

    // Wait a bit for server to start before loading UI
    setTimeout(() => {
        if (!isHeadless) {
            createWindow();
        }
        createTray();
        setupAutoUpdater();

        // Check for updates on startup (silently)
        if (!isDev) {
            setTimeout(() => {
                checkForUpdates();
            }, 5000);
        }
    }, 1500);
});

app.on('window-all-closed', () => {
    // Don't quit on macOS
    if (process.platform !== 'darwin') {
        // App stays running in tray
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    } else {
        mainWindow.show();
    }
});

app.on('before-quit', () => {
    (app as any).isQuitting = true;
});

// We catch exceptions at bootstrap, but just in case
process.on('uncaughtException', (error) => {
    console.error('[ELECTRON MAIN] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[ELECTRON MAIN] Unhandled rejection:', reason);
});
