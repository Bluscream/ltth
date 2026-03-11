# 🚀 LLM Start Here - PupCid's Little TikTool Helper (LTTH)

**Last Updated:** 2026-02-03  
**For:** AI Assistants, LLMs, GitHub Copilot  
**Purpose:** Comprehensive technical guide for working with this codebase

---

## 📋 Quick Start Checklist

Before making any changes, read these files in order:
1. **THIS FILE** - `/infos/llm_start_here.md` (you are here)
2. `/infos/CONTRIBUTING.md` - Contribution guidelines
3. `/infos/ARCHITECTURE.md` - System architecture
4. `/infos/DEVELOPMENT.md` - Development setup
5. `/.github/copilot-instructions.md` - Copilot-specific instructions

---

## 🎯 Project Overview

### What is LTTH?

**PupCid's Little TikTool Helper** is a professional TikTok LIVE streaming tool with overlays, alerts, Text-to-Speech, automation, and an extensive plugin ecosystem. Built as an Electron desktop application running Node.js backend with Express.js + Socket.IO.

### Key Facts

| Aspect | Details |
|--------|---------|
| **Name** | PupCid's Little TikTool Helper (LTTH) |
| **Type** | Electron Desktop App + Node.js Backend |
| **License** | CC-BY-NC-4.0 (Non-Commercial) |
| **Version** | 1.3.3 |
| **Developer** | Solo developer + Claude AI |
| **Stack** | Node.js 18-23, Express, Socket.IO, SQLite, Electron 33+ |
| **Architecture** | Plugin-based modular system |
| **Languages** | German (UI/Docs), English (Code/Comments) |

### Core Purpose

- **TikTok LIVE Integration:** Real-time events (gifts, chat, follows, shares, likes, subs)
- **Overlays & Alerts:** OBS-compatible browser sources with animations
- **Text-to-Speech:** 75+ TikTok voices, 30+ Google Cloud voices
- **Event Automation:** Visual flow engine for "if-then" rules
- **Plugin System:** 31 built-in plugins, hot-reloadable
- **Multi-User Profiles:** Separate configs per user with cloud sync support

---

## 📁 Repository Structure

```
ltth_desktop2/
├── .github/                      # GitHub configs, workflows, Copilot instructions
│   ├── copilot-instructions.md  # Copilot guidelines
│   └── copilot-setup-steps.yml  # Setup documentation
│
├── infos/                        # 🆕 Organized documentation hub
│   ├── llm_start_here.md        # THIS FILE
│   ├── CONTRIBUTING.md          # Contribution guidelines
│   ├── ARCHITECTURE.md          # System architecture
│   ├── DEVELOPMENT.md           # Development guide
│   ├── PLUGIN_DEVELOPMENT.md    # Plugin creation guide
│   ├── TESTING.md               # Testing guidelines
│   └── SECURITY.md              # Security best practices
│
├── app/                          # Main Node.js application
│   ├── server.js                # Main Express server (1500+ LOC)
│   ├── launch.js                # Application launcher
│   ├── package.json             # Dependencies
│   ├── modules/                 # Core backend modules
│   ├── plugins/                 # Plugin system (31 plugins)
│   ├── public/                  # Frontend (HTML/CSS/JS)
│   ├── routes/                  # Express routes
│   ├── locales/                 # i18n (de/en)
│   ├── wiki/                    # User documentation (German)
│   ├── test/                    # Test files
│   └── docs/                    # Technical docs
│
├── build-src/                    # Electron build configuration
├── docs/                         # Additional documentation
├── docs_archive/                 # Archived historical Fix-Summaries and PR-Summaries
├── migration-guides/             # Framework migration guides
├── screenshots/                  # Visual documentation
│
├── main.js                       # Electron main process
├── package.json                  # Electron app dependencies
├── README.md                     # User-facing README (German)
├── CHANGELOG.md                  # Version history
├── LICENSE                       # CC-BY-NC-4.0 license
└── DOCUMENTATION_INDEX.md        # Documentation navigation index
```

---

## 🏗️ Architecture Overview

### Technology Stack

**Backend:**
- **Runtime:** Node.js 18.x, 20.x, or 22.x
- **Framework:** Express.js 4.x
- **Real-time:** Socket.IO 4.x
- **Database:** SQLite (better-sqlite3) with WAL mode
- **Logging:** Winston 3.x with daily rotation
- **TikTok:** tiktok-live-connector (Eulerstream API)

**Frontend:**
- **UI Framework:** Bootstrap 5
- **Utility CSS:** Tailwind CSS
- **JavaScript:** jQuery + Vanilla JS
- **Real-time:** Socket.IO Client

**Desktop:**
- **Framework:** Electron 33.x
- **IPC:** Electron IPC for main-renderer communication

**External Integrations:**
- **OBS Studio:** obs-websocket-js v5 (WebSocket)
- **VRChat:** OSC protocol (UDP)
- **MyInstants:** Sound library (100k+ sounds)

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                         │
│  ┌──────────┬──────────────┬──────────────┬──────────────┐ │
│  │ TikTok   │ OBS Studio   │ VRChat       │ MyInstants   │ │
│  │ LIVE API │ WebSocket v5 │ OSC Protocol │ Sound Lib    │ │
│  └────┬─────┴──────┬───────┴──────┬───────┴──────┬───────┘ │
└───────┼────────────┼──────────────┼──────────────┼──────────┘
        │            │              │              │
        ▼            ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                  INTEGRATION LAYER                           │
│  ┌─────────────┬────────────┬────────────┬──────────────┐   │
│  │ tiktok.js   │ obs-       │ osc-bridge │ soundboard   │   │
│  │ connector   │ websocket  │ plugin     │ module       │   │
│  └──────┬──────┴─────┬──────┴─────┬──────┴──────┬───────┘   │
└─────────┼────────────┼────────────┼─────────────┼───────────┘
          │            │            │             │
          └────────────┴────────────┴─────────────┘
                       │
                       ▼
          ┌───────────────────────────┐
          │   EVENT BUS (server.js)   │
          │   Socket.IO + EventEmit   │
          └────────────┬──────────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
    ┌─────────┐  ┌─────────┐  ┌─────────┐
    │ Plugins │  │ Modules │  │ Clients │
    │ (31)    │  │ (Core)  │  │ (UI)    │
    └─────────┘  └─────────┘  └─────────┘
```

### Event Flow Example (Gift Event)

```
1. TikTok LIVE Stream → Gift sent
2. tiktok-live-connector → Receives WebSocket event
3. modules/tiktok.js → Parses and emits 'tiktok:gift'
4. server.js Event Bus → Broadcasts to listeners:
   ├─ modules/flows.js → Checks flow triggers, executes actions
   ├─ modules/alerts.js → Creates alert, emits 'alert:new'
   ├─ modules/goals.js → Increments coins goal
   ├─ modules/leaderboard.js → Updates top gifters
   └─ plugins/*/main.js → Plugin-registered callbacks
5. Socket.IO → Broadcasts to frontend clients
6. Frontend (Dashboard/Overlay) → Renders alert, updates UI
```

---

## 🔌 Plugin System

### Overview

LTTH uses a **hot-reloadable plugin system** with a well-defined lifecycle and API.

### Plugin Structure

```
plugins/<plugin-id>/
├── plugin.json       # Metadata (id, name, version, entry, author, description)
├── main.js           # Plugin class with init() and destroy()
├── ui.html           # Optional: Admin UI panel
├── overlay.html      # Optional: OBS overlay
├── assets/           # Optional: CSS, JS, images
├── README.md         # Plugin documentation
└── test/             # Optional: Plugin tests
```

### Plugin Class Template

```javascript
class MyPlugin {
  constructor(api) {
    this.api = api;
    this.io = api.getSocketIO();
    this.db = api.getDatabase();
  }

  async init() {
    // Register HTTP routes
    this.api.registerRoute('get', '/status', (req, res) => {
      res.json({ status: 'ok' });
    });

    // Register Socket.IO events
    this.api.registerSocket('myplugin:action', (data) => {
      this.handleAction(data);
    });

    // Register TikTok event listeners
    this.api.registerTikTokEvent('gift', (data) => {
      this.handleGift(data);
    });

    this.api.log('MyPlugin initialized', 'info');
  }

  async destroy() {
    // Cleanup: close connections, clear timers, remove listeners
    this.api.log('MyPlugin destroyed', 'info');
  }
}

module.exports = MyPlugin;
```

### Plugin API Methods

```javascript
// Configuration
api.getConfig(key)              // Load from database
api.setConfig(key, value)       // Save to database

// Data Storage
api.getPluginDataDir()          // Get persistent data directory
api.ensurePluginDataDir()       // Create data directory if missing
api.getConfigPathManager()      // Advanced path operations

// Routes & Events
api.registerRoute(method, path, handler)
api.registerSocket(event, callback)
api.registerTikTokEvent(event, callback)

// Communication
api.emit(event, data)           // Emit Socket.IO event to clients
api.log(message, level)         // Logger wrapper

// System Access
api.getSocketIO()               // Get Socket.IO instance
api.getDatabase()               // Get database instance
```

### ⚠️ Critical: Plugin Data Storage

**NEVER** store plugin data in the plugin directory (`__dirname`) or app folder. Data will be **lost during updates**.

**✅ ALWAYS use:**
- `api.getPluginDataDir()` for file storage (uploads, logs, cache)
- `api.setConfig()` / `api.getConfig()` for configuration and API keys
- Database tables for structured data

**Example:**
```javascript
// ✅ CORRECT: Persistent storage
const pluginDataDir = this.api.getPluginDataDir();
this.uploadDir = path.join(pluginDataDir, 'uploads');

// ❌ WRONG: Lost on update!
this.uploadDir = path.join(__dirname, 'uploads');
```

See `/app/docs/PLUGIN_DATA_STORAGE_GUIDE.md` for complete documentation.

---

## 💻 Core Modules

### Important Files & Line Counts

| File | LOC | Purpose |
|------|-----|---------|
| `app/server.js` | 1500+ | Main Express server, Socket.IO, Event bus |
| `app/modules/database.js` | 600+ | SQLite manager with WAL mode |
| `app/modules/plugin-loader.js` | 545 | Plugin system with hot-loading |
| `app/modules/update-manager.js` | 532 | Git/ZIP update system |
| `app/modules/validators.js` | 498 | Input validation |
| `app/routes/plugin-routes.js` | 484 | Plugin manager REST API |
| `app/public/js/plugin-manager.js` | 372 | Plugin manager frontend |

### Key Modules

**Database (`modules/database.js`):**
- SQLite with WAL mode for concurrency
- Prepared statements for SQL injection protection
- Batch writes for performance
- Transaction support

**TikTok Connector (`modules/tiktok.js`):**
- Wraps tiktok-live-connector library
- Parses and normalizes TikTok events
- Emits standardized events to event bus

**Flow Engine (`modules/flows.js`):**
- Event-driven automation ("if-then" rules)
- Condition evaluation with 9 operators
- Sequential action execution
- Logging to `user_data/flow_logs/`

**Plugin Loader (`modules/plugin-loader.js`):**
- Scans `plugins/` directory
- Loads plugin.json metadata
- Instantiates plugin classes
- Manages lifecycle (init/destroy)
- Hot-reload support

**Logger (`modules/logger.js`):**
- Winston-based logging
- Daily rotation (30 days)
- Levels: error, warn, info, debug
- Output: console + files

---

## 🎨 Code Style & Standards

### General Rules

- **Language:** Code and comments in English, UI/documentation in German
- **Indentation:** 2 spaces (NO tabs)
- **Quotes:** Single quotes for strings in JavaScript
- **Semicolons:** Use consistently
- **ES6+:** Use modern JavaScript (const/let, arrow functions, async/await, destructuring)

### Critical Rules

**✅ DO:**
- Use Winston logger (`logger.info()`, `logger.error()`)
- Wrap async operations in try-catch blocks
- Set default values when config is missing
- Validate all inputs before processing
- Use prepared statements for database queries
- Document with JSDoc comments
- Follow existing patterns in the codebase

**❌ DON'T:**
- Use `console.log` in production code (use logger instead)
- Remove or delete existing functionality
- Break backward compatibility without migration
- Commit secrets or API keys to repository
- Use synchronous file I/O (except database)
- Modify plugin APIs without updating all plugins

### Logging Example

```javascript
// Import logger
const logger = require('./modules/logger');

// Use appropriate levels
logger.info('Server started on port 3000');
logger.warn('TTS queue is full');
logger.error('Database connection failed', error);
logger.debug('Processing gift event', giftData);

// NEVER use console.log in production!
// ❌ console.log('User connected');
// ✅ logger.info('User connected');
```

### Error Handling Example

```javascript
async function myAsyncFunction() {
  try {
    const result = await someAsyncOperation();
    return result;
  } catch (error) {
    logger.error('Operation failed:', error);
    throw error; // Or return null, depending on use case
  }
}
```

### Configuration Example

```javascript
async init() {
  // ALWAYS set defaults
  const defaultConfig = {
    enabled: true,
    threshold: 100,
    sounds: []
  };
  
  let config = this.api.getConfig('myPluginConfig');
  if (!config) {
    config = defaultConfig;
    this.api.setConfig('myPluginConfig', config);
  }
  
  this.config = { ...defaultConfig, ...config };
}
```

---

## 🗄️ Database Schema

### SQLite Configuration

- **File:** `user_configs/<profile>/database.db`
- **Mode:** WAL (Write-Ahead Logging)
- **Library:** better-sqlite3 (synchronous)

### Main Tables

**settings** - Key-value configuration store
```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

**alert_configs** - Alert templates
```sql
CREATE TABLE alert_configs (
    event_type TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    text_template TEXT,
    sound_file TEXT,
    duration INTEGER DEFAULT 5000,
    image_url TEXT,
    animation_type TEXT
);
```

**flows** - Automation rules
```sql
CREATE TABLE flows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL,
    trigger_condition TEXT,
    actions TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
```

**gift_sounds** - Gift-to-sound mappings
```sql
CREATE TABLE gift_sounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gift_id INTEGER UNIQUE,
    label TEXT,
    mp3_url TEXT,
    volume REAL DEFAULT 1.0,
    animation_url TEXT,
    animation_type TEXT
);
```

**user_voices** - User-specific TTS voices
```sql
CREATE TABLE user_voices (
    username TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL
);
```

**top_gifters** - Leaderboard data
```sql
CREATE TABLE top_gifters (
    username TEXT PRIMARY KEY,
    total_coins INTEGER DEFAULT 0,
    gift_count INTEGER DEFAULT 0,
    last_gift_at INTEGER,
    profile_picture_url TEXT
);
```

**events** - Event history
```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    username TEXT,
    data TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
```

---

## 🧪 Testing

### Current State

- **Limited automated testing** - Manual testing is primary method
- Test infrastructure exists in `app/test/` directory
- Some plugins have tests in `plugins/<plugin-id>/test/`

### Running Tests

```bash
cd app
npm test                # Run all tests with Jest
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
node test/specific.test.js  # Run individual test
```

### Manual Testing Checklist

Before submitting changes:

**TikTok Connection:**
- [ ] Connection successful
- [ ] Gift events received
- [ ] Chat events received
- [ ] Follow/Subscribe/Share events work

**Alerts:**
- [ ] Test alert displays
- [ ] Sound plays
- [ ] Alert disappears after duration

**TTS:**
- [ ] Test TTS works
- [ ] Voice selection works
- [ ] Queue handles multiple TTS

**Goals:**
- [ ] Goal increment works
- [ ] Overlay shows correct value
- [ ] Goal reset works

**Flows:**
- [ ] Flow creation works
- [ ] Flow triggers on events
- [ ] Actions execute correctly

**Plugins:**
- [ ] Plugin enable/disable works
- [ ] Plugin config saves
- [ ] Plugin survives restart

---

## 🔒 Security

### Critical Rules

**NEVER:**
- Commit secrets, API keys, or passwords to repository
- Trust user input without validation
- Use string concatenation for SQL queries
- Expose sensitive data in logs or error messages

**ALWAYS:**
- Use `.env` files for sensitive configuration
- Sanitize user inputs before processing
- Validate data from external sources
- Use rate limiting for public APIs
- Check permissions before sensitive operations
- Use prepared statements for database queries

### Input Validation

```javascript
const { validateUsername, validateSettings } = require('./modules/validators');

app.post('/api/connect', (req, res) => {
  const { username } = req.body;
  
  if (!validateUsername(username)) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  
  // Process valid input
});
```

### SQL Injection Protection

```javascript
// ✅ CORRECT: Prepared statement
const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
const user = stmt.get(userId);

// ❌ WRONG: String concatenation
const user = db.prepare(`SELECT * FROM users WHERE id = ${userId}`).get();
```

---

## 🚀 Development Workflow

### Prerequisites

- Node.js 18.0.0+ (18.x, 20.x, or 22.x)
- npm (comes with Node.js)
- Git
- Modern browser (Chrome, Firefox, Edge)
- OBS Studio (optional, for testing overlays)

### Setup

```bash
# Clone repository
git clone https://github.com/Loggableim/ltth_desktop2.git
cd ltth_desktop2

# Install app dependencies
cd app
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env

# Start in development mode
npm run dev
```

### Development Commands

```bash
# In app/ directory:
npm start           # Start server (production)
npm run dev         # Start with nodemon (auto-reload)
npm run build:css   # Compile Tailwind CSS
npm run watch:css   # Watch Tailwind CSS changes
npm run lint        # Run ESLint
npm test            # Run tests
```

### Git Workflow

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes and commit: `git commit -m "Add: My feature"`
3. Push to remote: `git push origin feature/my-feature`
4. Open pull request on GitHub
5. Address code review feedback
6. Merge after approval

### Commit Message Format

```
<Type>: <Short description> (max 72 characters)

<Optional body: Detailed description>
- What was changed?
- Why was it changed?
- How was it implemented?

<Optional footer>
- Breaking changes: BREAKING CHANGE: ...
- Issue references: Closes #123
```

**Types:** Add, Update, Fix, Refactor, Docs, Test, Chore, Style, Perf

---

## 📚 Documentation Structure

### For Users (German)

- `README.md` - Project overview and quick start
- `app/wiki/` - Complete user documentation
  - `Wiki-Index.md` - Overview of all pages
  - `Getting-Started.md` - Quick start guide
  - `Plugin-Liste.md` - All 31 plugins
  - `Overlays-&-Alerts.md` - 25+ OBS overlays
  - `FAQ-&-Troubleshooting.md` - Problem solving

### For Developers (English)

- `/infos/llm_start_here.md` - THIS FILE
- `/infos/CONTRIBUTING.md` - Contribution guidelines
- `/infos/ARCHITECTURE.md` - System architecture
- `/infos/DEVELOPMENT.md` - Development setup
- `/infos/PLUGIN_DEVELOPMENT.md` - Plugin creation
- `/infos/TESTING.md` - Testing guidelines
- `/infos/SECURITY.md` - Security practices

### Technical Documentation

- `app/docs/` - Technical documentation
- `docs_archive/` - Archived historical Fix-Summaries, PR-Summaries, and implementation notes
- `migration-guides/` - Framework migration guides

---

## 🎯 Common Tasks

### Adding a New Feature

1. Read `/infos/CONTRIBUTING.md` for guidelines
2. Create feature branch
3. Implement feature following existing patterns
4. Add tests if infrastructure exists
5. Update relevant documentation
6. Update `app/CHANGELOG.md`
7. Submit pull request

### Creating a New Plugin

1. Read `/infos/PLUGIN_DEVELOPMENT.md` for detailed guide
2. Copy plugin template from existing plugin
3. Create `plugins/<plugin-id>/plugin.json`
4. Create `plugins/<plugin-id>/main.js` with init() and destroy()
5. Register routes, events, and TikTok listeners
6. Test plugin enable/disable/reload
7. Add README.md with documentation

### Fixing a Bug

1. Identify the root cause
2. Check if issue affects other areas
3. Write test to reproduce (if infrastructure exists)
4. Fix the bug with minimal changes
5. Verify fix doesn't break existing functionality
6. Update `app/CHANGELOG.md`
7. Submit pull request

### Updating Documentation

1. Keep documentation in sync with code
2. User docs in German (`app/wiki/`)
3. Developer docs in English (`/infos/`)
4. Update `app/CHANGELOG.md` for significant changes
5. Test all code examples

---

## 🚨 Critical Information

### File Locations That Matter

**Config & Data (gitignored):**
- `user_configs/` - User profile databases
- `user_data/` - Runtime data (flow logs, etc.)
- `logs/` - Application logs

**Never Commit:**
- `.env` files
- `user_configs/`
- `user_data/`
- `logs/`
- `*.db` files
- Node modules
- Build artifacts

### Plugin Data Storage

**Critical:** Plugins must use `api.getPluginDataDir()` for persistent storage. Never store data in plugin directory or app folder - it will be lost during updates.

### Breaking Changes

If you must make breaking changes:
1. Discuss in issue/PR first
2. Provide migration guide
3. Update all affected plugins
4. Document in CHANGELOG with BREAKING CHANGE: prefix
5. Consider backward compatibility shim

### Performance Considerations

- SQLite WAL mode enabled for concurrency
- Use prepared statements for repeated queries
- Batch database writes when possible
- Use Socket.IO rooms for targeted broadcasts
- Debounce high-frequency events
- Monitor memory usage in long-running processes

---

## 🔗 External Resources

### Documentation

- TikTok LIVE Connector: https://github.com/zerodytrash/TikTok-Live-Connector
- Socket.IO: https://socket.io/docs/
- OBS WebSocket: https://github.com/obsproject/obs-websocket
- Better SQLite3: https://github.com/WiseLibs/better-sqlite3
- Electron: https://www.electronjs.org/docs

### Support

- **Bugs:** Open GitHub issue
- **Email:** loggableim@gmail.com
- **License Questions:** Check CC-BY-NC-4.0 terms

---

## ✅ Before Making Changes

1. ✅ Read this file completely
2. ✅ Read `/infos/CONTRIBUTING.md`
3. ✅ Read relevant documentation in `/infos/`
4. ✅ Understand the architecture
5. ✅ Check existing patterns in codebase
6. ✅ Set up development environment
7. ✅ Test your changes thoroughly
8. ✅ Update documentation
9. ✅ Update CHANGELOG.md
10. ✅ Submit well-documented PR

---

## 📞 Contact

**Developer:** PupCid (Solo developer + Claude AI)  
**Email:** loggableim@gmail.com  
**License:** CC-BY-NC-4.0 (Non-Commercial)

---

**Remember:** This is a production application used by real streamers. Make surgical, well-tested changes. Follow existing patterns. Never break backward compatibility without migration. Always use the logger, never console.log. Test thoroughly before submitting.

**Good luck coding! 🚀**
