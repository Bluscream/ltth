/**
 * Wiki API Routes
 * Serves wiki documentation with markdown rendering
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

// marked is an ESM module, so we need to use dynamic import
// Use a Promise to ensure single initialization and prevent race conditions
let markedPromise = null;

// Initialize marked module asynchronously
async function initMarked() {
    if (!markedPromise) {
        markedPromise = (async () => {
            const markedModule = await import('marked');
            const marked = markedModule.marked;
            // Configure marked options
            marked.setOptions({
                headerIds: true,
                mangle: false,
                breaks: true,
                gfm: true
            });
            return marked;
        })();
    }
    return markedPromise;
}

// Base path for wiki files
const WIKI_BASE_PATH = path.join(__dirname, '../wiki');

// Wiki structure definition
const WIKI_STRUCTURE = {
    sections: [
        {
            id: 'getting-started',
            title: 'Getting Started',
            icon: 'rocket',
            pages: [
                { id: 'home', title: 'Home', icon: 'home', file: 'Home.md' },
                { id: 'wiki-index', title: 'Wiki Index', icon: 'list', file: 'Wiki-Index.md' },
                { id: 'getting-started', title: 'Getting Started', icon: 'play-circle', file: 'Getting-Started.md' },
                { id: 'installation', title: 'Installation & Setup', icon: 'download', file: 'Installation-&-Setup.md' },
                { id: 'configuration', title: 'Configuration', icon: 'settings', file: 'Konfiguration.md' },
                { id: 'faq', title: 'FAQ & Troubleshooting', icon: 'help-circle', file: 'FAQ-&-Troubleshooting.md' }
            ]
        },
        {
            id: 'plugins',
            title: 'Plugins',
            icon: 'puzzle',
            pages: [
                { id: 'plugin-overview', title: 'Plugin System', icon: 'plug', file: 'Plugin-Dokumentation.md' },
                { id: 'plugin-list', title: 'Plugin-Liste', icon: 'layout-list', file: 'Plugin-Liste.md' },
                { id: 'vdoninja', title: 'VDO.Ninja Multi-Guest', icon: 'users', file: 'Plugins/VDO-Ninja.md' }
            ]
        },
        {
            id: 'features',
            title: 'Features',
            icon: 'zap',
            pages: [
                { id: 'webgpu-engine', title: 'WebGPU Engine', icon: 'cpu', file: 'Features/WebGPU-Engine.md' },
                { id: 'gcce', title: 'GCCE', icon: 'terminal', file: 'Features/GCCE.md' },
                { id: 'emoji-rain', title: 'Emoji Rain', icon: 'smile', file: 'Features/Emoji-Rain.md' },
                { id: 'cloud-sync', title: 'Cloud Sync', icon: 'cloud', file: 'Features/Cloud-Sync.md' }
            ]
        },
        {
            id: 'overlays-streaming',
            title: 'Overlays & Streaming',
            icon: 'monitor',
            pages: [
                { id: 'overlays-alerts', title: 'Overlays & Alerts', icon: 'image', file: 'Overlays-&-Alerts.md' },
                { id: 'advanced-features', title: 'Advanced Features', icon: 'sliders-horizontal', file: 'Advanced-Features.md' },
                { id: 'alerts', title: 'Alert System', icon: 'bell', file: 'modules/alerts.md' },
                { id: 'flows', title: 'Automation Flows', icon: 'git-branch', file: 'modules/flows.md' }
            ]
        },
        {
            id: 'developer',
            title: 'Developer Documentation',
            icon: 'code',
            pages: [
                { id: 'architecture', title: 'Architecture', icon: 'layers', file: 'Architektur.md' },
                { id: 'developer-guide', title: 'Developer Guide', icon: 'book', file: 'Entwickler-Leitfaden.md' },
                { id: 'api-reference', title: 'API Reference', icon: 'server', file: 'API-Reference.md' }
            ]
        }
    ]
};

// Helper function to find page info by ID
function findPageById(pageId) {
    for (const section of WIKI_STRUCTURE.sections) {
        const page = section.pages.find(p => p.id === pageId);
        if (page) {
            return { page, section };
        }
    }
    return null;
}

function findPageByFile(filePath) {
    const normalizedPath = filePath
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .replace(/^\.\.\//, '')
        .toLowerCase();

    const normalizedFileName = normalizedPath.split('/').pop();

    for (const section of WIKI_STRUCTURE.sections) {
        for (const page of section.pages) {
            const pageFile = page.file.replace(/\\/g, '/').toLowerCase();
            const pageFileName = pageFile.split('/').pop();
            if (pageFile === normalizedPath || pageFileName === normalizedFileName) {
                return page;
            }
        }
    }

    return null;
}

// Helper function to extract table of contents from markdown
function extractTOC(markdown) {
    const headings = [];
    const lines = markdown.split('\n');
    
    lines.forEach(line => {
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
            const level = match[1].length;
            const text = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Remove links
            const id = text.toLowerCase()
                .replace(/[^a-z0-9äöüß\s-]/g, '') // Keep German umlauts
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            
            headings.push({
                level,
                text,
                id
            });
        }
    });
    
    // Build hierarchical TOC
    const toc = [];
    const stack = [{ level: 0, children: toc }];
    
    headings.forEach(heading => {
        // Skip h1 as it's usually the title
        if (heading.level === 1) return;
        
        while (stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }
        
        const item = {
            id: heading.id,
            text: heading.text,
            level: heading.level,
            children: []
        };
        
        stack[stack.length - 1].children.push(item);
        stack.push(item);
    });
    
    return toc;
}

// GET /api/wiki/structure - Get wiki navigation structure
router.get('/structure', (req, res) => {
    res.json(WIKI_STRUCTURE);
});

// GET /api/wiki/page/:pageId - Get rendered wiki page
router.get('/page/:pageId', async (req, res) => {
    try {
        const { pageId } = req.params;
        const { lang } = req.query; // Get language preference from query parameter
        const pageInfo = findPageById(pageId);
        
        if (!pageInfo) {
            return res.status(404).json({ error: 'Page not found' });
        }
        
        const { page, section } = pageInfo;
        
        // Try to read the file
        let filePath = path.join(WIKI_BASE_PATH, page.file);
        
        // If file doesn't exist in wiki folder, try plugins folder
        if (!await fileExists(filePath)) {
            filePath = path.join(__dirname, '..', page.file);
        }
        
        if (!await fileExists(filePath)) {
            // Create placeholder content for missing files
            const placeholderContent = createPlaceholderContent(page.title);
            const markdownParser = await initMarked();
            const html = markdownParser(placeholderContent);
            
            return res.json({
                id: page.id,
                title: page.title,
                html,
                toc: [],
                breadcrumb: [
                    { id: 'home', title: 'Home' },
                    { id: section.id, title: section.title },
                    { id: page.id, title: page.title }
                ],
                lastUpdated: new Date().toISOString()
            });
        }
        
        // Read and process the file
        const markdown = await fs.readFile(filePath, 'utf-8');
        
        // Extract TOC
        const toc = extractTOC(markdown);
        
        // Process markdown to fix internal links before rendering
        let processedMarkdown = markdown;
        
        // Convert markdown wiki links to in-app #wiki: links, including optional anchors
        processedMarkdown = processedMarkdown.replace(/\[([^\]]+)\]\(([^)\s]+\.md(?:#[^)]+)?)\)/g, (match, text, link) => {
            const [linkPath, anchor] = link.split('#');
            const foundPage = findPageByFile(linkPath);

            if (!foundPage) {
                return match;
            }

            const anchorPart = anchor ? `::${encodeURIComponent(anchor)}` : '';
            return `[${text}](#wiki:${foundPage.id}${anchorPart})`;
        });
        
        // Render markdown to HTML
        const markdownParser = await initMarked();
        let html = markdownParser(processedMarkdown);
        
        // Process image paths to be relative to server
        html = html.replace(/src="(?!http)([^"]+)"/g, (match, imgPath) => {
            // Convert relative image paths
            const assetsPath = `/assets/wiki/${imgPath}`;
            return `src="${assetsPath}"`;
        });
        
        // Add IDs to headings for TOC linking
        html = html.replace(/<h([2-6])>(.+?)<\/h\1>/g, (match, level, text) => {
            const cleanText = text.replace(/<[^>]+>/g, ''); // Remove any HTML tags
            const id = cleanText.toLowerCase()
                .replace(/[^a-z0-9äöüß\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            return `<h${level} id="${id}">${text}</h${level}>`;
        });
        
        // Build breadcrumb
        const breadcrumb = [
            { id: 'home', title: 'Home' },
            { id: section.id, title: section.title },
            { id: page.id, title: page.title }
        ];
        
        // Get file stats for last updated
        const stats = await fs.stat(filePath);
        
        res.json({
            id: page.id,
            title: page.title,
            html,
            toc,
            breadcrumb,
            lastUpdated: stats.mtime.toISOString(),
            preferredLanguage: lang || 'en', // Include language preference in response
            languageAnchor: getLanguageAnchor(lang) // Get anchor for scrolling
        });
        
    } catch (error) {
        console.error('Error loading wiki page:', error);
        res.status(500).json({ error: 'Failed to load page' });
    }
});

// GET /api/wiki/search - Search wiki content
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.json([]);
        }
        
        const query = q.toLowerCase();
        const results = [];
        
        // Search through all pages
        for (const section of WIKI_STRUCTURE.sections) {
            for (const page of section.pages) {
                // Check title match
                if (page.title.toLowerCase().includes(query)) {
                    results.push({
                        id: page.id,
                        title: page.title,
                        section: section.title,
                        excerpt: `Documentation for ${page.title}`,
                        matches: [query]
                    });
                    continue;
                }
                
                // Try to search in content
                try {
                    let filePath = path.join(WIKI_BASE_PATH, page.file);
                    if (!await fileExists(filePath)) {
                        filePath = path.join(__dirname, '..', page.file);
                    }
                    
                    if (await fileExists(filePath)) {
                        const content = await fs.readFile(filePath, 'utf-8');
                        const contentLower = content.toLowerCase();
                        
                        if (contentLower.includes(query)) {
                            // Extract excerpt around match
                            const index = contentLower.indexOf(query);
                            const start = Math.max(0, index - 50);
                            const end = Math.min(content.length, index + query.length + 100);
                            const excerpt = '...' + content.substring(start, end).replace(/\n/g, ' ') + '...';
                            
                            results.push({
                                id: page.id,
                                title: page.title,
                                section: section.title,
                                excerpt,
                                matches: [query]
                            });
                        }
                    }
                } catch (error) {
                    // Skip this page if error reading
                    continue;
                }
            }
        }
        
        res.json(results.slice(0, 10)); // Limit to 10 results
        
    } catch (error) {
        console.error('Error searching wiki:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Helper function to check if file exists
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Helper function to create placeholder content for missing documentation
function createPlaceholderContent(title) {
    return `# ${title}

## Documentation Coming Soon

This section is currently under development. Documentation for **${title}** will be added soon.

### What is ${title}?

${title} is a feature/plugin of Pup Cid's Little TikTok Helper that enhances your streaming experience.

### Getting Started

To use ${title}:

1. Navigate to the ${title} section in the sidebar
2. Configure your settings
3. Start using the feature in your stream

### Need Help?

If you have questions about ${title}, please:

- Check the FAQ section
- Contact support at loggableim@gmail.com
- Open an issue on GitHub

---

*This is placeholder content. Full documentation will be added in a future update.*
`;
}

// Helper function to get language anchor for scrolling
function getLanguageAnchor(lang) {
    const languageAnchors = {
        'en': 'english',
        'de': 'deutsch',
        'es': 'español',
        'fr': 'français'
    };
    return languageAnchors[lang] || 'english';
}

module.exports = router;
