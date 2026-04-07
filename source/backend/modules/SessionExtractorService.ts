import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import { DatabaseService } from './DatabaseService';
import { ConfigPathManager } from './ConfigPathManager';

/**
 * Session Extractor - Extracts TikTok session ID from Eulerstream API or browser
 */
export class SessionExtractorService {
    private db: DatabaseService;
    private configPathManager: ConfigPathManager | null;
    private sessionPath: string;
    private browser: any = null;
    private isExtracting: boolean = false;
    private puppeteer: any = null;

    constructor(db: DatabaseService, configPathManager: ConfigPathManager | null = null) {
        this.db = db;
        this.configPathManager = configPathManager;
        
        // Session storage path - use persistent location
        if (configPathManager) {
            this.sessionPath = path.join(configPathManager.getUserDataDir(), 'tiktok_session.json');
        } else {
            this.sessionPath = path.join(process.cwd(), 'user_data', 'tiktok_session.json');
        }
    }

    private loadPuppeteer(): any {
        if (!this.puppeteer) {
            try {
                // Try loading in order of preference
                try {
                    const puppeteerExtra = require('puppeteer-extra');
                    const stealthPlugin = require('puppeteer-extra-plugin-stealth');
                    puppeteerExtra.use(stealthPlugin());
                    this.puppeteer = puppeteerExtra;
                } catch {
                    try {
                        this.puppeteer = require('puppeteer');
                    } catch {
                        this.puppeteer = require('puppeteer-core');
                    }
                }
            } catch (err) {
                throw new Error('Puppeteer is not installed. Run: npm install puppeteer');
            }
        }
        return this.puppeteer;
    }

    private _extractSessionFromResponse(responseData: any): { sessionId: string; ttTargetIdc: string | null } | null {
        if (!responseData) return null;
        
        let sessionId: string | null = null;
        let ttTargetIdc: string | null = null;
        
        if (responseData.sessionId || responseData.session_id) {
            sessionId = responseData.sessionId || responseData.session_id;
        } else if (responseData.tiktok_session_id || responseData.tiktokSessionId) {
            sessionId = responseData.tiktok_session_id || responseData.tiktokSessionId;
        }
        
        if (!sessionId && responseData.data) {
            const data = responseData.data;
            sessionId = data.sessionId || data.session_id || data.tiktok_session_id || data.tiktokSessionId;
            ttTargetIdc = data.ttTargetIdc || data.tt_target_idc;
        }
        
        if (!sessionId && responseData.cookies) {
            const cookies: any[] = responseData.cookies;
            const sessionCookie = cookies.find(c => c.name === 'sessionid' || c.name === 'sessionId');
            if (sessionCookie) sessionId = sessionCookie.value;
            
            const idcCookie = cookies.find(c => c.name === 'tt-target-idc' || c.name === 'tt_target_idc');
            if (idcCookie) ttTargetIdc = idcCookie.value;
        }
        
        return sessionId ? { sessionId, ttTargetIdc } : null;
    }

    async extractSessionIdFromEulerstream(options: any = {}): Promise<any> {
        try {
            let apiKey = options.apiKey || 
                         this.db.getSetting('tiktok_euler_api_key') || 
                         this.db.getSetting('euler_api_key') ||
                         process.env.EULER_API_KEY;
            
            if (!apiKey) {
                return { success: false, error: 'No API key configured' };
            }

            const baseUrl = process.env.EULERSTREAM_API_URL || 'https://www.eulerstream.com/api';
            
            // Get account ID
            let accountId = options.accountId;
            if (!accountId) {
                const accountResponse = await axios.get(`${baseUrl}/accounts/me`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    timeout: 10000
                });
                accountId = accountResponse.data.id;
            }

            // Retrieve keys
            const keysResponse = await axios.get(`${baseUrl}/accounts/${accountId}/api_keys/retrieve`, {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: 10000
            });

            const extracted = this._extractSessionFromResponse(keysResponse.data);
            if (!extracted) {
                return { success: false, error: 'Session ID not found in API response' };
            }

            const { sessionId, ttTargetIdc } = extracted;
            this.db.setSetting('tiktok_session_id', sessionId);
            if (ttTargetIdc) this.db.setSetting('tiktok_tt_target_idc', ttTargetIdc);

            return {
                success: true,
                sessionId,
                ttTargetIdc,
                method: 'eulerstream_api'
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async extractSessionId(options: any = {}): Promise<any> {
        if (this.isExtracting) return { success: false, error: 'Extraction in progress' };
        this.isExtracting = true;

        try {
            const result = await this.extractSessionIdFromEulerstream(options);
            if (result.success) return result;

            // Fallback to Puppeteer if needed
            return await this._extractSessionIdWithPuppeteer(options);
        } finally {
            this.isExtracting = false;
        }
    }

    private async _extractSessionIdWithPuppeteer(options: any = {}): Promise<any> {
        try {
            const puppeteer = this.loadPuppeteer();
            const headless = options.headless !== undefined ? options.headless : 'new';
            this.browser = await puppeteer.launch({
                headless: headless,
                args: ['--no-sandbox']
            });
            const page = await this.browser.newPage();
            await page.goto('https://www.tiktok.com/', { waitUntil: 'networkidle2' });
            
            const cookies = await page.cookies();
            const sessionCookie = cookies.find((c: any) => c.name === 'sessionid');
            
            if (!sessionCookie) return { success: false, error: 'Session cookie not found' };

            const sessionId = sessionCookie.value;
            this.db.setSetting('tiktok_session_id', sessionId);

            return { success: true, sessionId, method: 'puppeteer' };
        } catch (error: any) {
            return { success: false, error: error.message };
        } finally {
            if (this.browser) await this.browser.close();
        }
    }

    private _saveSessionData(data: any): void {
        try {
            const dir = path.dirname(this.sessionPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.sessionPath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('Failed to save session data:', err);
        }
    }
}
