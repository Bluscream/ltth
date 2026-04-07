import fs from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';

export class I18nService {
    private defaultLocale: string;
    private currentLocale: string;
    private translations: Record<string, any> = {};
    private supportedLocales: string[] = ['en', 'de', 'es', 'fr'];

    constructor(defaultLocale: string = 'en') {
        this.defaultLocale = defaultLocale;
        this.currentLocale = defaultLocale;
        this.loadTranslations();
    }

    public loadTranslations(): void {
        const localesDir = path.join(__dirname, '..', 'locales');

        if (!fs.existsSync(localesDir)) {
            fs.mkdirSync(localesDir, { recursive: true });
        }

        for (const locale of this.supportedLocales) {
            const filePath = path.join(localesDir, `${locale}.json`);

            if (fs.existsSync(filePath)) {
                try {
                    this.translations[locale] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch (error: any) {
                    console.error(`Failed to load ${locale} translations:`, error.message);
                    this.translations[locale] = {};
                }
            } else {
                this.translations[locale] = {};
            }
        }

        this.loadPluginTranslations();
    }

    private loadPluginTranslations(): void {
        const pluginsDir = path.join(__dirname, '..', 'plugins');

        if (!fs.existsSync(pluginsDir)) {
            return;
        }

        let pluginsState: Record<string, any> = {};
        const legacyStateFile = path.join(pluginsDir, 'plugins_state.json');
        if (fs.existsSync(legacyStateFile)) {
            try {
                pluginsState = JSON.parse(fs.readFileSync(legacyStateFile, 'utf8'));
            } catch (error: any) {
                console.error('Failed to read plugins_state.json:', error.message);
            }
        }

        try {
            const plugins = fs.readdirSync(pluginsDir);

            for (const plugin of plugins) {
                const pluginManifestPath = path.join(pluginsDir, plugin, 'plugin.json');
                let manifest: any = null;
                if (fs.existsSync(pluginManifestPath)) {
                    try {
                        manifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'));
                    } catch (error: any) {
                        console.error(`Failed to read plugin.json for plugin ${plugin}:`, error.message);
                    }
                }

                if (manifest) {
                    const pluginState = pluginsState[manifest.id] || {};
                    const isEnabled = pluginState.enabled !== undefined ? pluginState.enabled : manifest.enabled !== false;
                    if (!isEnabled) {
                        continue;
                    }
                }

                const pluginLocalesDir = path.join(pluginsDir, plugin, 'locales');

                if (fs.existsSync(pluginLocalesDir)) {
                    for (const locale of this.supportedLocales) {
                        const pluginLocalePath = path.join(pluginLocalesDir, `${locale}.json`);

                        if (fs.existsSync(pluginLocalePath)) {
                            try {
                                const pluginTranslations = JSON.parse(fs.readFileSync(pluginLocalePath, 'utf8'));

                                if (!this.translations[locale]) {
                                    this.translations[locale] = {};
                                }

                                this.translations[locale] = this.deepMerge(
                                    this.translations[locale],
                                    pluginTranslations
                                );
                            } catch (error: any) {
                                console.error(`Failed to load ${locale} translations for plugin ${plugin}:`, error.message);
                            }
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error('Error loading plugin translations:', error.message);
        }
    }

    private deepMerge(target: any, source: any): any {
        const output = Object.assign({}, target);

        if (this.isObject(target) && this.isObject(source)) {
            Object.keys(source).forEach(key => {
                if (this.isObject(source[key])) {
                    if (!(key in target)) {
                        Object.assign(output, { [key]: source[key] });
                    } else {
                        output[key] = this.deepMerge(target[key], source[key]);
                    }
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }

        return output;
    }

    private isObject(item: any): boolean {
        return item && typeof item === 'object' && !Array.isArray(item);
    }

    public setLocale(locale: string): boolean {
        if (this.translations[locale]) {
            this.currentLocale = locale;
            return true;
        }
        return false;
    }

    public getLocale(): string {
        return this.currentLocale;
    }

    public t(key: string, params: Record<string, any> = {}, locale: string | null = null): string {
        const targetLocale = locale || this.currentLocale;
        const keys = key.split('.');

        let translation = this.translations[targetLocale];

        for (const k of keys) {
            if (translation && typeof translation === 'object' && k in translation) {
                translation = translation[k];
            } else {
                translation = this.translations[this.defaultLocale];
                for (const fallbackKey of keys) {
                    if (translation && typeof translation === 'object' && fallbackKey in translation) {
                        translation = translation[fallbackKey];
                    } else {
                        return key;
                    }
                }
                break;
            }
        }

        if (typeof translation !== 'string') {
            return key;
        }

        return this.interpolate(translation, params);
    }

    private interpolate(str: string, params: Record<string, any>): string {
        return str.replace(/\{(\w+)\}/g, (match, key) => {
            return key in params ? params[key] : match;
        });
    }

    public getAvailableLocales(): string[] {
        return Object.keys(this.translations);
    }

    public getAllTranslations(locale: string | null = null): any {
        const targetLocale = locale || this.currentLocale;
        return this.translations[targetLocale] || {};
    }

    public reloadTranslations(): void {
        this.loadTranslations();
    }

    public middleware() {
        return (req: Request, res: Response, next: NextFunction) => {
            const locale = (req.query.lang as string) || req.headers['accept-language']?.split(',')[0]?.split('-')[0] || 'en';
            
            // @ts-ignore - Injecting onto request object for legacy compatibility
            req.i18n = this;
            // @ts-ignore
            req.locale = locale;
            // @ts-ignore
            req.t = (key: string, params: Record<string, any> = {}) => this.t(key, params, locale);

            next();
        };
    }
}

export const i18nService = new I18nService('en');
