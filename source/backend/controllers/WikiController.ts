import { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { ILogger } from '../modules/LoggerService';

// Marked is handled via dynamic import in the controller to avoid dual-module issues
let markedPromise: Promise<any> | null = null;

const WIKI_BASE_PATH = path.join(__dirname, '../../wiki');

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

export class WikiController {
    constructor(private readonly logger: ILogger) {}

    private async initMarked(): Promise<any> {
        if (!markedPromise) {
            markedPromise = (async () => {
                const markedModule = await import('marked');
                const marked = markedModule.marked;
                marked.setOptions({
                    headerIds: true,
                    mangle: false,
                    breaks: true,
                    gfm: true
                } as any);
                return marked;
            })();
        }
        return markedPromise;
    }

    private findPageById(pageId: string) {
        for (const section of WIKI_STRUCTURE.sections) {
            const page = section.pages.find(p => p.id === pageId);
            if (page) {
                return { page, section };
            }
        }
        return null;
    }

    private findPageByFile(filePath: string) {
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

    private extractTOC(markdown: string) {
        const headings: any[] = [];
        const lines = markdown.split('\n');
        
        lines.forEach(line => {
            const match = line.match(/^(#{1,6})\s+(.+)$/);
            if (match) {
                const level = match[1].length;
                const text = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
                const id = text.toLowerCase()
                    .replace(/[^a-z0-9äöüß\s-]/g, '')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
                
                headings.push({ level, text, id });
            }
        });
        
        const toc: any[] = [];
        const stack = [{ level: 0, children: toc }];
        
        headings.forEach(heading => {
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
            stack.push(item as any);
        });
        
        return toc;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private createPlaceholderContent(title: string): string {
        return `# ${title}\n\n## Documentation Coming Soon\n\nThis section is currently under development.`;
    }

    private getLanguageAnchor(lang: string | undefined): string {
        const languageAnchors: any = {
            'en': 'english',
            'de': 'deutsch',
            'es': 'español',
            'fr': 'français'
        };
        return languageAnchors[lang || 'en'] || 'english';
    }

    public getStructure = (req: Request, res: Response) => {
        res.json(WIKI_STRUCTURE);
    };

    public getPage = async (req: Request, res: Response) => {
        try {
            const { pageId } = req.params;
            const lang = req.query.lang as string;
            const pageInfo = this.findPageById(pageId);
            
            if (!pageInfo) {
                return res.status(404).json({ error: 'Page not found' });
            }
            
            const { page, section } = pageInfo;
            let filePath = path.join(WIKI_BASE_PATH, page.file);
            
            if (!await this.fileExists(filePath)) {
                filePath = path.join(__dirname, '../../app', page.file);
            }
            
            if (!await this.fileExists(filePath)) {
                const placeholderContent = this.createPlaceholderContent(page.title);
                const markdownParser = await this.initMarked();
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
            
            const markdown = await fs.readFile(filePath, 'utf-8');
            const toc = this.extractTOC(markdown);
            let processedMarkdown = markdown;
            
            processedMarkdown = processedMarkdown.replace(/\[([^\]]+)\]\(([^)\s]+\.md(?:#[^)]+)?)\)/g, (match, text, link) => {
                const [linkPath, anchor] = link.split('#');
                const foundPage = this.findPageByFile(linkPath);
                if (!foundPage) return match;
                const anchorPart = anchor ? `::${encodeURIComponent(anchor)}` : '';
                return `[${text}](#wiki:${foundPage.id}${anchorPart})`;
            });
            
            const markdownParser = await this.initMarked();
            let html = markdownParser(processedMarkdown);
            
            html = html.replace(/src="(?!http)([^"]+)"/g, (match, imgPath) => `/assets/wiki/${imgPath}`);
            
            html = html.replace(/<h([2-6])>(.+?)<\/h\1>/g, (match, level, text) => {
                const cleanText = text.replace(/<[^>]+>/g, '');
                const id = cleanText.toLowerCase()
                    .replace(/[^a-z0-9äöüß\s-]/g, '')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
                return `<h${level} id="${id}">${text}</h${level}>`;
            });
            
            const stats = await fs.stat(filePath);
            
            res.json({
                id: page.id,
                title: page.title,
                html,
                toc,
                breadcrumb: [
                    { id: 'home', title: 'Home' },
                    { id: section.id, title: section.title },
                    { id: page.id, title: page.title }
                ],
                lastUpdated: stats.mtime.toISOString(),
                preferredLanguage: lang || 'en',
                languageAnchor: this.getLanguageAnchor(lang)
            });
            
        } catch (error: any) {
            this.logger.error('Error loading wiki page:', error);
            res.status(500).json({ error: 'Failed to load page' });
        }
    };

    public search = async (req: Request, res: Response) => {
        try {
            const q = req.query.q as string;
            if (!q || q.length < 2) return res.json([]);
            
            const query = q.toLowerCase();
            const results: any[] = [];
            
            for (const section of WIKI_STRUCTURE.sections) {
                for (const page of section.pages) {
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
                    
                    try {
                        let filePath = path.join(WIKI_BASE_PATH, page.file);
                        if (!await this.fileExists(filePath)) {
                            filePath = path.join(__dirname, '../../app', page.file);
                        }
                        
                        if (await this.fileExists(filePath)) {
                            const content = await fs.readFile(filePath, 'utf-8');
                            const contentLower = content.toLowerCase();
                            
                            if (contentLower.includes(query)) {
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
                    } catch {
                        continue;
                    }
                }
            }
            res.json(results.slice(0, 10));
        } catch (error: any) {
            this.logger.error('Error searching wiki:', error);
            res.status(500).json({ error: 'Search failed' });
        }
    };
}
