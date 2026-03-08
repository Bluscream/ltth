# Plugin Development Guide

**PupCid's Little TikTool Helper (LTTH)**  
**Version:** 1.2.2  
**Last Updated:** 2026-01-20

---

## 📑 Table of Contents

1. [Overview](#overview)
2. [Plugin Structure](#plugin-structure)
3. [Plugin API Reference](#plugin-api-reference)
4. [Lifecycle Hooks](#lifecycle-hooks)
5. [Creating Your First Plugin](#creating-your-first-plugin)
6. [Data Storage & Persistence](#data-storage--persistence)
7. [Event System](#event-system)
8. [Frontend Integration](#frontend-integration)
9. [Best Practices](#best-practices)
10. [Plugin Packaging & Distribution](#plugin-packaging--distribution)
11. [Troubleshooting](#troubleshooting)

---

## 🔍 Overview

The plugin system allows you to extend LTTH functionality without modifying core code. Plugins can:

- **Register HTTP Routes** - Create REST API endpoints
- **Subscribe to Socket.IO Events** - Real-time client communication
- **Listen to TikTok Events** - React to gifts, chat, follows, etc.
- **Access Database** - Store/retrieve settings and data
- **Integrate External APIs** - OBS, OSC, HTTP requests
- **Provide Admin UI** - HTML interface for configuration

### Features

✅ **Hot-Reloading** - Load/disable plugins without server restart  
✅ **ZIP Upload** - Upload plugins via web UI  
✅ **Plugin API** - Simple integration with core system  
✅ **Isolation** - Plugins cannot interfere with each other  
✅ **Config Management** - Plugin-specific settings in database  
✅ **Persistent Storage** - Dedicated data directory per plugin

---

## 📁 Plugin Structure

### Minimal Plugin

```
plugins/my-plugin/
├── plugin.json       # Metadata (required)
└── main.js           # Plugin class (required)
```

### Complete Plugin

```
plugins/my-plugin/
├── plugin.json       # Metadata
├── main.js           # Plugin class
├── ui.html           # Optional: Admin UI
├── overlay.html      # Optional: OBS overlay
├── assets/           # Optional: Static assets
│   ├── style.css
│   ├── script.js
│   └── icon.png
├── README.md         # Optional: Documentation
└── test/             # Optional: Tests
    └── main.test.js
```

### plugin.json

**Required Fields:**

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Description of what the plugin does",
  "version": "1.0.0",
  "author": "Your Name",
  "entry": "main.js",
  "enabled": true,
  "type": "utility",
  "dependencies": ["express", "socket.io"],
  "permissions": ["tiktok-events", "database"]
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique plugin ID (kebab-case, no spaces) |
| `name` | String | Display name |
| `description` | String | Short description of functionality |
| `version` | String | Semantic versioning (1.0.0) |
| `author` | String | Author name/email |
| `entry` | String | Entry point file (usually "main.js") |
| `enabled` | Boolean | Initially enabled? |
| `type` | String | Plugin type (see below) |
| `dependencies` | Array | NPM dependencies (informational) |
| `permissions` | Array | Required permissions (see below) |

**Plugin Types:**
- `utility` - General utility plugins
- `overlay` - Overlay-related (HUD, alerts)
- `integration` - External integrations (OBS, OSC, VRChat)

**Permissions:**
- `tiktok-events` - Subscribe to TikTok events
- `database` - Database access
- `filesystem` - File system access
- `network` - HTTP requests

### main.js

**Minimal Example:**

```javascript
class MyPlugin {
    constructor(api) {
        this.api = api;
    }
    
    async init() {
        this.api.log('My Plugin started');
    }
    
    async destroy() {
        this.api.log('My Plugin stopped');
    }
}

module.exports = MyPlugin;
```

---

## 🔌 Plugin API Reference

The `PluginAPI` class is passed to your plugin constructor and provides access to the core system.

### Configuration Methods

#### getConfig(key)

Load plugin configuration from database.

**Parameters:**
- `key` (String) - Configuration key

**Returns:** Configuration value (Object/String/Number/Boolean/null)

**Example:**
```javascript
const config = this.api.getConfig('config');
if (!config) {
    // Set default config
    this.api.setConfig('config', { enabled: true });
}
```

#### setConfig(key, value)

Save plugin configuration to database.

**Parameters:**
- `key` (String) - Configuration key
- `value` (Any) - Configuration value (stored as JSON)

**Example:**
```javascript
this.api.setConfig('config', {
    enabled: true,
    maxItems: 100,
    thresholds: [10, 50, 100]
});
```

### Data Storage Methods

#### getPluginDataDir()

Get persistent data directory for this plugin (survives updates).

**Returns:** String - Absolute path to plugin data directory

**Example:**
```javascript
const pluginDataDir = this.api.getPluginDataDir();
this.uploadDir = path.join(pluginDataDir, 'uploads');
```

#### ensurePluginDataDir()

Ensure plugin data directory exists (creates if needed).

**Returns:** String - Absolute path to plugin data directory

**Example:**
```javascript
const dataDir = this.api.ensurePluginDataDir();
fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify(data));
```

#### getConfigPathManager()

Get ConfigPathManager instance for advanced path operations.

**Returns:** ConfigPathManager instance

#### registerBackupProvider(provider)

Register a custom backup provider so the Backup & Restore system can use plugin-specific export/import logic.

If no provider is registered, the system uses a generic fallback: reading `plugin:<id>:*` settings from the database and collecting files from the plugin data directory.

**Parameters:**
- `provider` – Object with at least one of:
  - `exportConfig(): Promise<{ settings?, warnings? }>` – return the plugin's settings to include in the backup
  - `importConfig(payload): Promise<{ success, importedKeys?, warnings? }>` – apply a previously-exported payload

**Returns:** `boolean` – true if registration succeeded

**Example:**
```javascript
async init() {
    this.api.registerBackupProvider({
        exportConfig: async () => ({
            settings: { apiKey: this.config.apiKey, theme: this.config.theme },
            warnings: this.config.apiKey ? [] : ['API key not set – backup may be incomplete']
        }),
        importConfig: async ({ settings, mode }) => {
            if (settings.apiKey) {
                await this.api.setConfig('config', { ...this.config, ...settings });
                return { success: true, importedKeys: Object.keys(settings) };
            }
            return { success: false, warnings: ['No settings in payload'] };
        }
    });
}
```

#### getBackupManager()

Get the BackupManager instance (if initialised).

**Returns:** `BackupManager|null`

### Route Registration

#### registerRoute(method, path, handler)

Register an Express route handler.

**Parameters:**
- `method` (String) - HTTP method: 'GET', 'POST', 'PUT', 'DELETE'
- `path` (String) - Route path (relative to `/api/plugins/<plugin-id>`)
- `handler` (Function) - Express handler: `(req, res) => {}`

**Example:**
```javascript
this.api.registerRoute('GET', '/status', (req, res) => {
    res.json({
        success: true,
        status: 'ok'
    });
});
```

**Accessed at:** `http://localhost:3000/api/plugins/my-plugin/status`

### Socket.IO Event Methods

#### registerSocket(event, callback)

Register a Socket.IO event listener.

**Parameters:**
- `event` (String) - Event name
- `callback` (Function) - Handler: `(socket, ...args) => {}`

**Example:**
```javascript
this.api.registerSocket('myplugin:action', async (socket, data) => {
    this.api.log(`Received action: ${data.action}`);
    this.api.emit('myplugin:response', { result: 'success' });
});
```

**Frontend Usage:**
```javascript
socket.emit('myplugin:action', { action: 'doSomething' });
socket.on('myplugin:response', (data) => {
    console.log(data.result);
});
```

#### emit(event, data)

Send Socket.IO event to all connected clients.

**Parameters:**
- `event` (String) - Event name
- `data` (Object) - Event data

**Example:**
```javascript
this.api.emit('myplugin:update', {
    status: 'processing',
    progress: 50
});
```

### TikTok Event Methods

#### registerTikTokEvent(event, callback)

Register a TikTok event listener.

**Parameters:**
- `event` (String) - TikTok event: 'gift', 'chat', 'follow', 'subscribe', 'share', 'like'
- `callback` (Function) - Handler: `async (data) => {}`

**Example:**
```javascript
this.api.registerTikTokEvent('gift', async (data) => {
    this.api.log(`Gift received: ${data.giftName} from ${data.username}`);
    
    if (data.giftName === 'Rose') {
        this.api.emit('myplugin:rose-received', {
            username: data.username,
            coins: data.coins
        });
    }
});
```

**Event Data Structures:**

**Gift Event:**
```javascript
{
  username: 'user123',
  giftName: 'Rose',
  giftId: 5655,
  coins: 1,
  count: 1,
  profilePictureUrl: 'https://...'
}
```

**Chat Event:**
```javascript
{
  username: 'user123',
  message: 'Hello world',
  profilePictureUrl: 'https://...'
}
```

**Follow Event:**
```javascript
{
  username: 'user123',
  profilePictureUrl: 'https://...'
}
```

### System Access Methods

#### getSocketIO()

Get Socket.IO instance for advanced usage.

**Returns:** Socket.IO server instance

**Example:**
```javascript
const io = this.api.getSocketIO();
io.to('room123').emit('event', data); // Room-specific broadcast
```

#### getDatabase()

Get database instance for direct access.

**Returns:** Database instance

**Example:**
```javascript
const db = this.api.getDatabase();
const result = db.prepare('SELECT * FROM events WHERE type = ?').all('gift');
```

### Logging Method

#### log(message, level)

Log messages via Winston logger.

**Parameters:**
- `message` (String) - Log message
- `level` (String) - Log level: 'info', 'warn', 'error', 'debug' (default: 'info')

**Example:**
```javascript
this.api.log('Plugin started');
this.api.log('Warning: Config missing', 'warn');
this.api.log('Error occurred', 'error');
this.api.log('Debug info', 'debug');
```

**Log Output:**
```
[2026-01-20 12:00:00] [Plugin:my-plugin] info: Plugin started
```

---

## 🔄 Lifecycle Hooks

### 1. constructor(api)

**When:** Plugin is instantiated (on load)

**Purpose:** Save API instance, initialize member variables

**Example:**
```javascript
constructor(api) {
    this.api = api;
    this.counter = 0;
    this.timers = [];
    this.connections = new Map();
}
```

### 2. init()

**When:** Plugin is activated (initial load or after enable)

**Purpose:**
- Register routes
- Register Socket.IO events
- Register TikTok events
- Load configuration
- Establish external connections
- Start timers

**Example:**
```javascript
async init() {
    this.api.log('Initializing...');
    
    // Load config
    this.config = this.api.getConfig('config') || this.getDefaultConfig();
    
    // Register routes
    this.api.registerRoute('GET', '/stats', (req, res) => {
        res.json({ counter: this.counter });
    });
    
    // Subscribe to TikTok events
    this.api.registerTikTokEvent('gift', async (data) => {
        this.counter++;
    });
    
    // Start timer
    this.timer = setInterval(() => {
        this.api.emit('myplugin:counter', { count: this.counter });
    }, 5000);
    
    this.api.log('Initialized successfully');
}
```

### 3. destroy()

**When:** Plugin is deactivated (disable, reload, server shutdown)

**Purpose:**
- Clean up timers
- Close connections
- Save last state
- Free resources

**Example:**
```javascript
async destroy() {
    this.api.log('Stopping...');
    
    // Stop timers
    if (this.timer) {
        clearInterval(this.timer);
    }
    
    // Close external connections
    if (this.connection) {
        await this.connection.disconnect();
    }
    
    // Save last state
    this.api.setConfig('lastCounter', this.counter);
    
    this.api.log('Stopped successfully');
}
```

---

## 🛠️ Creating Your First Plugin

Let's create a "Gift Counter" plugin that counts received gifts.

### Step 1: Create Directory

```bash
cd plugins/
mkdir gift-counter
cd gift-counter
```

### Step 2: Create plugin.json

```json
{
  "id": "gift-counter",
  "name": "Gift Counter",
  "description": "Counts received gifts and shows top gift",
  "version": "1.0.0",
  "author": "Your Name",
  "entry": "main.js",
  "enabled": true,
  "type": "utility",
  "dependencies": ["express", "socket.io"],
  "permissions": ["tiktok-events", "database"]
}
```

### Step 3: Create main.js

```javascript
/**
 * Gift Counter Plugin
 * Counts all received gifts and shows the most frequent gift
 */
class GiftCounterPlugin {
    constructor(api) {
        this.api = api;
        this.giftCounts = {}; // { giftName: count }
        this.totalGifts = 0;
    }
    
    async init() {
        this.api.log('Gift Counter Plugin initializing...');
        
        // Load config
        let config = this.api.getConfig('config');
        if (!config) {
            config = {
                enabled: true,
                showTopGift: true
            };
            this.api.setConfig('config', config);
        }
        this.config = config;
        
        // Load saved counts
        const savedCounts = this.api.getConfig('giftCounts');
        if (savedCounts) {
            this.giftCounts = savedCounts;
            this.totalGifts = Object.values(savedCounts).reduce((a, b) => a + b, 0);
        }
        
        // Register API endpoints
        this.registerRoutes();
        
        // Register Socket.IO events
        this.registerSocketEvents();
        
        // Register TikTok events
        this.registerTikTokEvents();
        
        this.api.log('Gift Counter Plugin initialized successfully');
    }
    
    registerRoutes() {
        // GET /api/plugins/gift-counter/stats
        this.api.registerRoute('GET', '/stats', (req, res) => {
            res.json({
                success: true,
                totalGifts: this.totalGifts,
                giftCounts: this.giftCounts,
                topGift: this.getTopGift()
            });
        });
        
        // POST /api/plugins/gift-counter/reset
        this.api.registerRoute('POST', '/reset', (req, res) => {
            this.giftCounts = {};
            this.totalGifts = 0;
            this.api.setConfig('giftCounts', {});
            
            this.api.emit('giftcounter:reset', {});
            
            res.json({ success: true });
        });
    }
    
    registerSocketEvents() {
        // Client can request stats
        this.api.registerSocket('giftcounter:request-stats', async (socket, data) => {
            socket.emit('giftcounter:stats', {
                totalGifts: this.totalGifts,
                giftCounts: this.giftCounts,
                topGift: this.getTopGift()
            });
        });
    }
    
    registerTikTokEvents() {
        // Subscribe to gift events
        this.api.registerTikTokEvent('gift', async (data) => {
            if (!this.config.enabled) return;
            
            const giftName = data.giftName;
            const count = data.count || 1;
            
            // Increment count
            this.giftCounts[giftName] = (this.giftCounts[giftName] || 0) + count;
            this.totalGifts += count;
            
            // Save to database every 10 gifts
            if (this.totalGifts % 10 === 0) {
                this.api.setConfig('giftCounts', this.giftCounts);
            }
            
            // Send update to clients
            this.api.emit('giftcounter:update', {
                totalGifts: this.totalGifts,
                giftCounts: this.giftCounts,
                topGift: this.getTopGift()
            });
            
            this.api.log(`Gift received: ${giftName} x${count} (Total: ${this.totalGifts})`, 'debug');
        });
    }
    
    getTopGift() {
        let topGift = null;
        let maxCount = 0;
        
        for (const [giftName, count] of Object.entries(this.giftCounts)) {
            if (count > maxCount) {
                maxCount = count;
                topGift = { name: giftName, count };
            }
        }
        
        return topGift;
    }
    
    async destroy() {
        this.api.log('Gift Counter Plugin stopping...');
        
        // Save last counts
        this.api.setConfig('giftCounts', this.giftCounts);
        
        this.api.log('Gift Counter Plugin stopped');
    }
}

module.exports = GiftCounterPlugin;
```

### Step 4: Test Plugin

**Load Plugin:**
```bash
npm start
```

Plugin should auto-load on server start.

**Test API:**
```bash
curl http://localhost:3000/api/plugins/gift-counter/stats
```

**Test Live:**
- Connect to TikTok LIVE
- Send gifts
- Stats should update

---

## 💾 Data Storage & Persistence

### ⚠️ Critical: Never Store Data in Plugin Directory

**NEVER** store plugin data in the plugin directory (`__dirname`) or app folder. This data will be **lost during updates**.

**✅ ALWAYS use:**
- `api.getPluginDataDir()` for file storage (uploads, logs, cache)
- `api.setConfig()` / `api.getConfig()` for configuration and API keys
- Database tables for structured data

### Correct Storage Example

```javascript
async init() {
    // ✅ CORRECT: Persistent storage
    const pluginDataDir = this.api.getPluginDataDir();
    this.uploadDir = path.join(pluginDataDir, 'uploads');
    this.logFile = path.join(pluginDataDir, 'plugin.log');
    
    // Ensure directory exists
    if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    
    // ❌ WRONG: Lost on update!
    // this.uploadDir = path.join(__dirname, 'uploads');
}
```

### Configuration Storage

```javascript
// Save configuration
this.api.setConfig('settings', {
    apiKey: 'secret-key',
    endpoint: 'https://api.example.com',
    options: { timeout: 5000 }
});

// Load configuration
const settings = this.api.getConfig('settings');
if (!settings) {
    // Use defaults
}
```

### Database Tables

For structured data, create custom tables:

```javascript
async init() {
    const db = this.api.getDatabase();
    
    // Create custom table
    db.exec(`
        CREATE TABLE IF NOT EXISTS plugin_my_plugin_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE,
            value TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now'))
        )
    `);
    
    // Use prepared statements
    const stmt = db.prepare('INSERT INTO plugin_my_plugin_data (key, value) VALUES (?, ?)');
    stmt.run('example', JSON.stringify({ data: 'value' }));
}
```

---

## 🎯 Event System

### TikTok Events

Available events: `gift`, `chat`, `follow`, `subscribe`, `share`, `like`

```javascript
this.api.registerTikTokEvent('gift', async (data) => {
    // Process gift
});

this.api.registerTikTokEvent('chat', async (data) => {
    // Process chat message
});
```

### Socket.IO Events

**Receive from clients:**
```javascript
this.api.registerSocket('myplugin:command', async (socket, data) => {
    // Process command
});
```

**Send to clients:**
```javascript
this.api.emit('myplugin:notification', { message: 'Hello' });
```

**Room-specific broadcasts:**
```javascript
const io = this.api.getSocketIO();
io.to('room-name').emit('event', data);
```

---

## 🎨 Frontend Integration

### Creating Admin UI (ui.html)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>My Plugin</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            padding: 20px;
        }
    </style>
</head>
<body>
    <h1>My Plugin</h1>
    <div id="stats"></div>
    
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        
        socket.on('myplugin:update', (data) => {
            document.getElementById('stats').innerHTML = 
                `Total: ${data.total}`;
        });
        
        fetch('/api/plugins/my-plugin/stats')
            .then(res => res.json())
            .then(data => console.log(data));
    </script>
</body>
</html>
```

**Accessed at:** `http://localhost:3000/plugins/my-plugin/ui.html`

---

## ✅ Best Practices

### 1. Error Handling

Always wrap async operations in try-catch:

```javascript
this.api.registerRoute('GET', '/data', async (req, res) => {
    try {
        const data = await this.fetchData();
        res.json({ success: true, data });
    } catch (error) {
        this.api.log(`Error fetching data: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: error.message });
    }
});
```

### 2. Config Validation

Always set defaults:

```javascript
let config = this.api.getConfig('config');
if (!config) {
    config = this.getDefaultConfig();
    this.api.setConfig('config', config);
}
```

### 3. Cleanup in destroy()

Free all resources:

```javascript
async destroy() {
    // Stop timers
    if (this.timer) clearInterval(this.timer);
    
    // Close connections
    if (this.connection) await this.connection.close();
    
    // Save state
    this.api.setConfig('lastState', this.state);
}
```

### 4. Use Logger

Never use console.log:

```javascript
this.api.log('Plugin started');  // Info
this.api.log('Warning', 'warn');  // Warning
this.api.log('Error', 'error');   // Error
this.api.log('Debug', 'debug');   // Debug
```

### 5. Rate Limiting

For frequent events:

```javascript
let lastUpdate = 0;

this.api.registerTikTokEvent('like', async (data) => {
    const now = Date.now();
    if (now - lastUpdate < 1000) return; // Max 1x per second
    
    lastUpdate = now;
    // Process event
});
```

---

## 📦 Plugin Packaging & Distribution

### Creating ZIP Package

```bash
cd plugins/
zip -r my-plugin.zip my-plugin/
```

### Via Web UI

1. Dashboard → Plugins → "Upload Plugin"
2. Select ZIP file
3. Upload
4. Enable plugin

### Via API

```bash
curl -X POST http://localhost:3000/api/plugins/upload \
  -F "file=@my-plugin.zip"
```

---

## 🐛 Troubleshooting

### Plugin Doesn't Load

**Check:**
1. `plugin.json` syntax errors
2. `enabled: true` in plugin.json
3. Server logs in `logs/combined.log`
4. File permissions

### Plugin Crashes Server

**Solutions:**
1. Disable in `plugin.json`: `"enabled": false`
2. Add try-catch in `init()`
3. Check for missing dependencies

### Config Not Saved

**Solutions:**
1. Use `api.setConfig()`
2. Save in `destroy()`
3. Check database: `SELECT * FROM settings WHERE key LIKE 'plugin:my-plugin:%'`

### Events Not Received

**Solutions:**
1. Call `registerTikTokEvent()` before `init()` completes
2. Use async callback: `async (data) => {}`
3. Verify TikTok connection status

---

## 🔗 Related Documentation

- `/infos/ARCHITECTURE.md` - System architecture
- `/infos/DEVELOPMENT.md` - Development guide
- `/infos/SECURITY.md` - Security best practices
- `/app/docs/PLUGIN_DATA_STORAGE_GUIDE.md` - Data storage details

---

*Last Updated: 2026-01-20*  
*Version: 1.2.2*
