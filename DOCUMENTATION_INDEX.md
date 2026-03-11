# 📚 LTTH Documentation Index

Welcome to the documentation index for PupCid's Little TikTool Helper (LTTH). This guide helps you find the right documentation for your needs.

---

## 🚀 Quick Start

**New to LTTH?** Start here:
1. Read the [README.md](README.md) for project overview
2. Follow [Getting Started Guide](app/wiki/Getting-Started.md) for installation
3. Explore [Plugin List](app/wiki/Plugin-Liste.md) to see features

**Developers?** Start here:
1. Read [LLM Start Here](/infos/llm_start_here.md) for comprehensive technical guide
2. Review [Contributing Guidelines](/infos/CONTRIBUTING.md)
3. Check [Architecture Documentation](/infos/ARCHITECTURE.md)

---

## 📂 Documentation Structure

### `/infos/` - Developer Documentation (English)

**For AI Assistants & Developers:**

| File | Purpose | Audience |
|------|---------|----------|
| [llm_start_here.md](/infos/llm_start_here.md) | **START HERE** - Comprehensive technical guide | AI assistants, new developers |
| [CONTRIBUTING.md](/infos/CONTRIBUTING.md) | Contribution guidelines, Git workflow, code standards | Contributors |
| [ARCHITECTURE.md](/infos/ARCHITECTURE.md) | System architecture, modules, data flow | Developers, architects |
| [DEVELOPMENT.md](/infos/DEVELOPMENT.md) | Development setup, debugging, build process | Developers |
| [PLUGIN_DEVELOPMENT.md](/infos/PLUGIN_DEVELOPMENT.md) | Complete plugin development guide | Plugin developers |
| [TESTING.md](/infos/TESTING.md) | Testing strategies and best practices | QA, developers |
| [SECURITY.md](/infos/SECURITY.md) | Security guidelines and best practices | All developers |

### `app/wiki/` - User Documentation (German)

**For End Users & Streamers:**

| File | Purpose |
|------|---------|
| [Wiki-Index.md](app/wiki/Wiki-Index.md) | Complete overview of all wiki pages |
| [Getting-Started.md](app/wiki/Getting-Started.md) | 5-minute quick start guide |
| [Installation-&-Setup.md](app/wiki/Installation-&-Setup.md) | Detailed installation instructions |
| [Plugin-Liste.md](app/wiki/Plugin-Liste.md) | All 31 plugins with descriptions |
| [Overlays-&-Alerts.md](app/wiki/Overlays-&-Alerts.md) | 25+ OBS overlays guide |
| [Advanced-Features.md](app/wiki/Advanced-Features.md) | WebGPU, GCCE, performance features |
| [FAQ-&-Troubleshooting.md](app/wiki/FAQ-&-Troubleshooting.md) | Common problems and solutions |
| [Konfiguration.md](app/wiki/Konfiguration.md) | Configuration guide |
| [Entwickler-Leitfaden.md](app/wiki/Entwickler-Leitfaden.md) | Developer guide (German) |
| [Plugin-Dokumentation.md](app/wiki/Plugin-Dokumentation.md) | Plugin documentation (German) |
| [API-Reference.md](app/wiki/API-Reference.md) | REST API & WebSocket reference |
| [Architektur.md](app/wiki/Architektur.md) | Architecture documentation (German) |

### `.github/` - GitHub Configuration

| File | Purpose |
|------|---------|
| [copilot-instructions.md](.github/copilot-instructions.md) | GitHub Copilot coding guidelines |
| [copilot-setup-steps.yml](.github/copilot-setup-steps.yml) | Repository structure and setup guide |

### Root Directory

| File | Purpose |
|------|---------|
| [README.md](README.md) | Project overview, features, quick start (German) |
| [CHANGELOG.md](CHANGELOG.md) | Version history and release notes |
| [LICENSE](LICENSE) | CC-BY-NC-4.0 license |
| **DOCUMENTATION_INDEX.md** | This file - documentation navigation |

### `docs/` - Technical Documentation

| Directory | Content |
|-----------|---------|
| `docs/` | Additional technical documentation, PDFs |

### `docs_archive/` - Historical Documentation

**Contains 140+ archived implementation summaries and fix documentation:**
- Bug fix summaries (e.g. `FIX_SUMMARY.md`, `PLUGIN_FIX_SUMMARY.md`, `LAUNCHER_FIX_SUMMARY.md`)
- Feature implementation reports
- Performance optimization analyses
- Migration guides
- Testing reports
- PR summaries and release notes (e.g. `PULL_REQUEST_SUMMARY.md`, `FINAL_SUMMARY.md`)

These files are kept for historical reference but are not actively maintained.

### `migration-guides/` - Framework Migration Guides

| File | Purpose |
|------|---------|
| [01_NSIS_INSTALLER_GUIDE.md](migration-guides/01_NSIS_INSTALLER_GUIDE.md) | NSIS installer setup |
| [02_NWJS_MIGRATION_GUIDE.md](migration-guides/02_NWJS_MIGRATION_GUIDE.md) | NW.js migration guide |
| [03_TAURI_MIGRATION_GUIDE.md](migration-guides/03_TAURI_MIGRATION_GUIDE.md) | Tauri migration guide |
| [README.md](migration-guides/README.md) | Migration overview |

---

## 🎯 Finding What You Need

### I want to...

**...understand the project**
→ Read [README.md](README.md) and [Architecture](/infos/ARCHITECTURE.md)

**...install and use LTTH**
→ Follow [Getting Started](app/wiki/Getting-Started.md)

**...contribute code**
→ Read [LLM Start Here](/infos/llm_start_here.md) and [Contributing](/infos/CONTRIBUTING.md)

**...create a plugin**
→ Follow [Plugin Development Guide](/infos/PLUGIN_DEVELOPMENT.md)

**...set up development environment**
→ Follow [Development Guide](/infos/DEVELOPMENT.md)

**...configure overlays for OBS**
→ Check [Overlays & Alerts Guide](app/wiki/Overlays-&-Alerts.md)

**...troubleshoot an issue**
→ Check [FAQ & Troubleshooting](app/wiki/FAQ-&-Troubleshooting.md)

**...understand security practices**
→ Read [Security Guidelines](/infos/SECURITY.md)

**...write tests**
→ Follow [Testing Guide](/infos/TESTING.md)

**...use the REST API**
→ Check [API Reference](app/wiki/API-Reference.md)

**...understand plugin system**
→ Read [Architecture](/infos/ARCHITECTURE.md) and [Plugin Development](/infos/PLUGIN_DEVELOPMENT.md)

---

## 📖 Reading Order

### For New Developers

1. [README.md](README.md) - Understand what LTTH is
2. [/infos/llm_start_here.md](/infos/llm_start_here.md) - Comprehensive technical overview
3. [/infos/ARCHITECTURE.md](/infos/ARCHITECTURE.md) - System design
4. [/infos/DEVELOPMENT.md](/infos/DEVELOPMENT.md) - Setup your environment
5. [/infos/CONTRIBUTING.md](/infos/CONTRIBUTING.md) - Learn the workflow
6. Pick a task and start coding!

### For Plugin Developers

1. [README.md](README.md) - Understand LTTH
2. [/infos/llm_start_here.md](/infos/llm_start_here.md) - Technical overview
3. [/infos/PLUGIN_DEVELOPMENT.md](/infos/PLUGIN_DEVELOPMENT.md) - Plugin guide
4. [app/wiki/Plugin-Liste.md](app/wiki/Plugin-Liste.md) - See existing plugins
5. Create your plugin!

### For End Users

1. [README.md](README.md) - Project overview
2. [app/wiki/Getting-Started.md](app/wiki/Getting-Started.md) - Installation
3. [app/wiki/Konfiguration.md](app/wiki/Konfiguration.md) - Configuration
4. [app/wiki/Plugin-Liste.md](app/wiki/Plugin-Liste.md) - Available plugins
5. [app/wiki/Overlays-&-Alerts.md](app/wiki/Overlays-&-Alerts.md) - OBS setup
6. [app/wiki/FAQ-&-Troubleshooting.md](app/wiki/FAQ-&-Troubleshooting.md) - Troubleshooting

### For AI Assistants

1. [/infos/llm_start_here.md](/infos/llm_start_here.md) - **READ THIS FIRST**
2. [/infos/CONTRIBUTING.md](/infos/CONTRIBUTING.md) - Coding standards
3. [/infos/ARCHITECTURE.md](/infos/ARCHITECTURE.md) - System architecture
4. [/.github/copilot-instructions.md](.github/copilot-instructions.md) - Copilot guidelines
5. Relevant specific guides as needed

---

## 🔄 Documentation Maintenance

### When to Update Documentation

**Always update when:**
- Adding new features
- Fixing bugs
- Changing APIs
- Modifying architecture
- Adding/removing dependencies
- Changing build process

**Files to update:**
- `CHANGELOG.md` - Always update with changes
- Relevant wiki pages (if user-facing changes)
- `/infos/` files (if developer-facing changes)
- Code comments (if internal changes)

### Documentation Language Policy

- **Code & Comments:** English
- **User Documentation (app/wiki/):** German
- **Developer Documentation (/infos/):** English
- **Commit Messages:** English (using defined types)

---

## 📞 Support & Contact

**Questions about documentation?**
- Email: loggableim@gmail.com
- GitHub Issues: https://github.com/Loggableim/ltth_desktop2/issues

**Found a documentation error?**
- Open an issue or submit a PR to fix it

---

## 🏆 Documentation Quality

This documentation aims to be:
- ✅ **Complete** - Covers all aspects of the project
- ✅ **Clear** - Easy to understand for target audience
- ✅ **Accurate** - Up-to-date with codebase
- ✅ **Organized** - Easy to navigate and find information
- ✅ **Practical** - Includes examples and code snippets
- ✅ **Maintained** - Regularly updated

---

**Last Updated:** 2026-01-20  
**Documentation Version:** 2.0 (Reorganized Structure)

**Happy coding! 🚀**
