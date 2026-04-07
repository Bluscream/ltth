import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { ILogger } from './LoggerService';
import { DatabaseService } from './DatabaseService';

export type BindMode = 'local' | 'select' | 'all' | 'custom';
export type TunnelProvider = 'cloudflare' | 'ngrok' | 'localtunnel' | 'custom';

export interface InterfaceInfo {
    name: string;
    label: string;
    ip: string;
    type: 'loopback' | 'lan-private' | 'link-local' | 'public';
}

export interface TunnelConfig {
    binaryPath?: string;
    namedTunnel?: string;
    authToken?: string;
    subdomain?: string;
    region?: string;
    command?: string;
}

export interface AccessURLs {
    local: string;
    localhost: string;
    lan: Array<{ ip: string; label: string; url: string }>;
    custom: string | null;
    external: string[];
    tunnel: string | null;
    primary: string;
}

export interface NetworkConfigResponse {
    bindMode: BindMode;
    bindAddress: string;
    resolvedBindAddress: string;
    selectedIfaces: string[];
    externalURLs: string[];
    tunnelEnabled: boolean;
    tunnelProvider: TunnelProvider;
    tunnelConfig: TunnelConfig;
    tunnelURL: string | null;
    tunnelStarting: boolean;
    corsExtra: string[];
    interfaces: InterfaceInfo[];
    accessURLs: AccessURLs;
    allowedOrigins: string[];
}

const PRIVATE_RANGES_REGEX = /^https?:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|localhost|127\.\d+\.\d+\.\d+)(:\d+)?$/;

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch (_) {
        return fallback;
    }
}

function classifyIP(ip: string): InterfaceInfo['type'] {
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.')) return 'loopback';
    if (ip.startsWith('169.254.')) return 'link-local';
    if (
        ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    ) return 'lan-private';
    return 'public';
}

function ifaceLabel(name: string, ip: string): string {
    const n = name.toLowerCase();
    if (n.includes('tailscale') || n.startsWith('ts')) return 'Tailscale VPN';
    if (n.includes('zerotier') || n.startsWith('zt')) return 'ZeroTier';
    if (n.startsWith('docker') || n.startsWith('br-') || n.startsWith('veth')) return 'Docker';
    if (n.includes('wireguard') || n.startsWith('wg')) return 'WireGuard';
    if (n.startsWith('wlan') || n.startsWith('wlp') || n.startsWith('wi-fi') || n.includes('wireless')) return 'WiFi';
    if (n.match(/^en\d+$/)) return 'Network Adapter';
    if (n.startsWith('eth') || n.startsWith('ens') || n.startsWith('enp') || n.includes('ethernet')) return 'Ethernet';
    if (n.includes('loopback') || n === 'lo') return 'Loopback';
    if (n.startsWith('tun') || n.startsWith('tap')) return 'VPN Tunnel';
    return name;
}

export class NetworkManager {
    private tunnelProcess: ChildProcess | null = null;
    private tunnelURL: string | null = null;
    private tunnelStarting: boolean = false;

    private bindMode: BindMode = 'local';
    private bindAddress: string = '127.0.0.1';
    public selectedIfaces: string[] = [];
    public externalURLs: string[] = [];
    public tunnelEnabled: boolean = false;
    public tunnelProvider: TunnelProvider = 'cloudflare';
    private tunnelConfig: TunnelConfig = {};
    private corsExtra: string[] = [];

    constructor(
        private readonly db: DatabaseService,
        private readonly logger: ILogger
    ) {}

    /**
     * Load settings from DB and return the resolved bind address.
     */
    public init(): { bindAddress: string } {
        this.bindMode = (this.db.getSetting('network_bind_mode') as BindMode) || 'local';
        this.bindAddress = this.db.getSetting('network_bind_address') || '127.0.0.1';
        this.selectedIfaces = safeJsonParse(this.db.getSetting('network_selected_ifaces'), []);
        this.externalURLs = safeJsonParse(this.db.getSetting('network_external_urls'), []);
        this.tunnelEnabled = this.db.getSetting('network_tunnel_enabled') === 'true';
        this.tunnelProvider = (this.db.getSetting('network_tunnel_provider') as TunnelProvider) || 'cloudflare';
        this.tunnelConfig = safeJsonParse(this.db.getSetting('network_tunnel_config'), {});
        this.corsExtra = safeJsonParse(this.db.getSetting('network_cors_extra'), []);

        const resolved = this.resolveBindAddress();
        this.logger.info(`🌐 NetworkManager: bind mode="${this.bindMode}", address=${resolved}`);
        return { bindAddress: resolved };
    }

    private resolveBindAddress(): string {
        switch (this.bindMode) {
            case 'local':
                return '127.0.0.1';
            case 'select':
            case 'all':
                return '0.0.0.0';
            case 'custom':
                return this.bindAddress || '127.0.0.1';
            default:
                return '127.0.0.1';
        }
    }

    /**
     * Return all detected IPv4 network interfaces.
     */
    public getInterfaces(): InterfaceInfo[] {
        const ifaces = os.networkInterfaces();
        const result: InterfaceInfo[] = [];

        for (const [name, addresses] of Object.entries(ifaces)) {
            if (!addresses) continue;
            for (const addr of addresses) {
                if (addr.family !== 'IPv4') continue;
                const type = classifyIP(addr.address);
                result.push({
                    name,
                    label: ifaceLabel(name, addr.address),
                    ip: addr.address,
                    type
                });
            }
        }

        const order: Record<string, number> = { loopback: 0, 'lan-private': 1, 'link-local': 2, public: 3 };
        result.sort((a, b) => (order[a.type] ?? 4) - (order[b.type] ?? 4));
        return result;
    }

    /**
     * Build the complete CORS allowed-origins list for the given port.
     */
    public getAllowedOrigins(port: number): string[] {
        const origins = new Set<string>();

        origins.add(`http://localhost:${port}`);
        origins.add(`http://127.0.0.1:${port}`);
        origins.add('null');

        if (this.bindMode === 'all' || this.bindMode === 'select') {
            const ifaces = this.getInterfaces();
            for (const iface of ifaces) {
                if (iface.type !== 'loopback') {
                    origins.add(`http://${iface.ip}:${port}`);
                }
            }
            if (this.bindMode === 'select' && this.selectedIfaces.length > 0) {
                for (const iface of ifaces) {
                    if (iface.type !== 'loopback' && !this.selectedIfaces.includes(iface.ip)) {
                        origins.delete(`http://${iface.ip}:${port}`);
                    }
                }
            }
        }

        if (this.bindMode === 'custom' && this.bindAddress) {
            origins.add(`http://${this.bindAddress}:${port}`);
        }

        for (const url of this.externalURLs) {
            const clean = url.replace(/\/$/, '');
            origins.add(clean);
            if (clean.startsWith('http://')) {
                origins.add(clean.replace('http://', 'https://'));
            } else if (clean.startsWith('https://')) {
                origins.add(clean.replace('https://', 'http://'));
            }
        }

        if (this.tunnelURL) {
            origins.add(this.tunnelURL);
            if (this.tunnelURL.startsWith('https://')) {
                origins.add(this.tunnelURL.replace('https://', 'http://'));
            }
        }

        for (const origin of this.corsExtra) {
            origins.add(origin);
        }

        return Array.from(origins);
    }

    public isOriginAllowed(origin: string | undefined, port: number): boolean {
        if (!origin) return true;
        const allowed = this.getAllowedOrigins(port);
        if (allowed.includes(origin)) return true;
        if (this.bindMode === 'all' || this.bindMode === 'select') {
            if (PRIVATE_RANGES_REGEX.test(origin)) return true;
        }
        return false;
    }

    public getIPRestrictionMiddleware(): (req: any, res: any, next: () => void) => any {
        return (req, res, next) => {
            if (this.bindMode !== 'select' || this.selectedIfaces.length === 0) {
                return next();
            }

            const remoteAddr: string = req.socket.remoteAddress || '';
            const localAddr: string = req.socket.localAddress || '';
            const loopbacks = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

            if (loopbacks.some(l => remoteAddr.includes(l) || localAddr.includes(l))) {
                return next();
            }

            const normalizedLocal = localAddr.replace('::ffff:', '');
            if (this.selectedIfaces.includes(normalizedLocal)) {
                return next();
            }

            const normalizedRemote = remoteAddr.replace('::ffff:', '');
            if (this.selectedIfaces.includes(normalizedRemote)) {
                return next();
            }

            this.logger.warn(`🚫 NetworkManager: blocked request from ${remoteAddr} (not in selected interfaces)`);
            return res.status(403).json({ error: 'Access denied: this network interface is not allowed.' });
        };
    }

    public async startTunnel(port: number): Promise<string> {
        if (this.tunnelProcess) {
            throw new Error('A tunnel is already running. Stop it first.');
        }

        this.tunnelStarting = true;
        this.tunnelURL = null;

        try {
            const url = await this._spawnTunnel(port);
            this.tunnelURL = url;
            this.tunnelStarting = false;
            this.logger.info(`🚇 Tunnel started: ${url}`);
            return url;
        } catch (err: any) {
            this.tunnelStarting = false;
            this.tunnelProcess = null;
            throw err;
        }
    }

    public stopTunnel(): void {
        if (!this.tunnelProcess) return;
        try {
            this.tunnelProcess.kill('SIGTERM');
        } catch (_) {}
        this.tunnelProcess = null;
        this.tunnelURL = null;
        this.tunnelStarting = false;
        this.logger.info('🚇 Tunnel stopped.');
    }

    private _spawnTunnel(port: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const provider = this.tunnelProvider;
            const cfg = this.tunnelConfig || {};
            const TIMEOUT_MS = 30000;

            let child: ChildProcess;
            let resolved = false;

            const done = (url: string) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                resolve(url);
            };

            const fail = (err: Error) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                if (child && !child.killed) child.kill('SIGTERM');
                reject(err);
            };

            const timer = setTimeout(() => {
                fail(new Error(`Tunnel URL not detected within ${TIMEOUT_MS / 1000}s`));
            }, TIMEOUT_MS);

            if (provider === 'cloudflare') {
                const bin = cfg.binaryPath || 'cloudflared';
                const args = ['tunnel', '--url', `http://localhost:${port}`];

                if (cfg.namedTunnel) {
                    args.splice(0, args.length, 'tunnel', 'run', cfg.namedTunnel);
                }

                child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
                this.tunnelProcess = child;

                const handler = (data: any) => {
                    const text = data.toString();
                    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                    if (match) done(match[0]);
                    const match2 = text.match(/https:\/\/[^\s"]+\.cfargotunnel\.com/);
                    if (match2) done(match2[0]);
                };
                child.stdout?.on('data', handler);
                child.stderr?.on('data', handler);

            } else if (provider === 'ngrok') {
                const bin = cfg.binaryPath || 'ngrok';
                const args = ['http', String(port)];
                if (cfg.authToken) args.push('--authtoken', cfg.authToken);
                if (cfg.subdomain) args.push('--subdomain', cfg.subdomain);
                if (cfg.region) args.push('--region', cfg.region);

                child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
                this.tunnelProcess = child;

                const pollInterval = setInterval(async () => {
                    try {
                        const http = require('http');
                        const apiUrl = 'http://127.0.0.1:4040/api/tunnels';
                        await new Promise<void>((res2) => {
                            http.get(apiUrl, (r: any) => {
                                let body = '';
                                r.on('data', (d: string) => { body += d; });
                                r.on('end', () => {
                                    try {
                                        const data = JSON.parse(body);
                                        const tunnel = (data.tunnels || []).find((t: any) => t.proto === 'https');
                                        if (tunnel) {
                                            clearInterval(pollInterval);
                                            done(tunnel.public_url);
                                        }
                                        res2();
                                    } catch (_) { res2(); }
                                });
                            }).on('error', () => res2());
                        });
                    } catch (_) {}
                }, 1000);

                child.on('exit', () => clearInterval(pollInterval));

            } else if (provider === 'localtunnel') {
                const args = ['localtunnel', '--port', String(port)];
                if (cfg.subdomain) args.push('--subdomain', cfg.subdomain);

                child = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
                this.tunnelProcess = child;

                child.stdout?.on('data', (data: any) => {
                    const text = data.toString();
                    const match = text.match(/https?:\/\/[^\s]+\.loca\.lt/);
                    if (match) done(match[0]);
                });

            } else if (provider === 'custom') {
                const command = (cfg.command || '').replace('{{PORT}}', String(port));
                if (!command) {
                    fail(new Error('Custom tunnel command is empty'));
                    return;
                }

                const parts = command.split(/\s+/);
                child = spawn(parts[0], parts.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
                this.tunnelProcess = child;

                const handler = (data: any) => {
                    const text = data.toString();
                    const match = text.match(/https:\/\/[^\s"']+/);
                    if (match) done(match[0]);
                };
                child.stdout?.on('data', handler);
                child.stderr?.on('data', handler);

            } else {
                fail(new Error(`Unknown tunnel provider: ${provider}`));
                return;
            }

            child.on('error', (err) => {
                fail(new Error(`Failed to spawn tunnel process: ${err.message}`));
            });

            child.on('exit', (code) => {
                if (!resolved) {
                    fail(new Error(`Tunnel process exited prematurely (code ${code})`));
                }
                this.tunnelProcess = null;
                if (this.tunnelURL) {
                    this.logger.warn('🚇 Tunnel process exited while URL was active.');
                    this.tunnelURL = null;
                }
            });
        });
    }

    public addExternalURL(url: string): string[] {
        const clean = url.trim().replace(/\/$/, '');
        if (!clean) throw new Error('URL must not be empty');
        if (!this.externalURLs.includes(clean)) {
            this.externalURLs.push(clean);
            this.db.setSetting('network_external_urls', JSON.stringify(this.externalURLs));
        }
        return this.externalURLs;
    }

    public removeExternalURL(url: string): string[] {
        const clean = url.trim().replace(/\/$/, '');
        this.externalURLs = this.externalURLs.filter(u => u !== clean);
        this.db.setSetting('network_external_urls', JSON.stringify(this.externalURLs));
        return this.externalURLs;
    }

    public getAccessURLs(port: number): AccessURLs {
        const local = `http://127.0.0.1:${port}`;
        const localhost = `http://localhost:${port}`;

        const lan: Array<{ ip: string; label: string; url: string }> = [];
        if (this.bindMode === 'all' || this.bindMode === 'select' || this.bindMode === 'custom') {
            const ifaces = this.getInterfaces();
            for (const iface of ifaces) {
                if (iface.type === 'loopback') continue;
                if (this.bindMode === 'select' && this.selectedIfaces.length > 0 && !this.selectedIfaces.includes(iface.ip)) continue;
                if (this.bindMode === 'custom' && iface.ip !== this.bindAddress) continue;
                lan.push({ ip: iface.ip, label: iface.label, url: `http://${iface.ip}:${port}` });
            }
        }

        const custom = (this.bindMode === 'custom' && this.bindAddress)
            ? `http://${this.bindAddress}:${port}`
            : null;

        const primary = this.tunnelURL || custom || (lan.length > 0 ? lan[0].url : localhost);

        return {
            local,
            localhost,
            lan,
            custom,
            external: [...this.externalURLs],
            tunnel: this.tunnelURL || null,
            primary
        };
    }

    public getConfig(port: number): NetworkConfigResponse {
        return {
            bindMode: this.bindMode,
            bindAddress: this.bindAddress,
            resolvedBindAddress: this.resolveBindAddress(),
            selectedIfaces: this.selectedIfaces,
            externalURLs: this.externalURLs,
            tunnelEnabled: this.tunnelEnabled,
            tunnelProvider: this.tunnelProvider,
            tunnelConfig: this._safeTunnelConfig(),
            tunnelURL: this.tunnelURL,
            tunnelStarting: this.tunnelStarting,
            corsExtra: this.corsExtra,
            interfaces: this.getInterfaces(),
            accessURLs: this.getAccessURLs(port),
            allowedOrigins: this.getAllowedOrigins(port)
        };
    }

    private _safeTunnelConfig(): TunnelConfig {
        const cfg = { ...this.tunnelConfig };
        if (cfg.authToken) cfg.authToken = '***';
        return cfg;
    }

    public applyConfig(body: any): { needsRestart: boolean } {
        const bindModeChanged = body.bindMode !== undefined && body.bindMode !== this.bindMode;
        const bindAddressChanged = body.bindAddress !== undefined && body.bindAddress !== this.bindAddress;
        const needsRestart = bindModeChanged || bindAddressChanged;

        if (body.bindMode !== undefined) {
            const valid: BindMode[] = ['local', 'select', 'all', 'custom'];
            if (!valid.includes(body.bindMode)) throw new Error(`Invalid bindMode: ${body.bindMode}`);
            this.bindMode = body.bindMode;
            this.db.setSetting('network_bind_mode', this.bindMode);
        }

        if (body.bindAddress !== undefined) {
            this.bindAddress = body.bindAddress;
            this.db.setSetting('network_bind_address', this.bindAddress);
        }

        if (body.selectedIfaces !== undefined) {
            this.selectedIfaces = Array.isArray(body.selectedIfaces) ? body.selectedIfaces : [];
            this.db.setSetting('network_selected_ifaces', JSON.stringify(this.selectedIfaces));
        }

        if (body.externalURLs !== undefined) {
            this.externalURLs = Array.isArray(body.externalURLs) ? body.externalURLs : [];
            this.db.setSetting('network_external_urls', JSON.stringify(this.externalURLs));
        }

        if (body.corsExtra !== undefined) {
            this.corsExtra = Array.isArray(body.corsExtra) ? body.corsExtra : [];
            this.db.setSetting('network_cors_extra', JSON.stringify(this.corsExtra));
        }

        if (body.tunnelEnabled !== undefined) {
            this.tunnelEnabled = Boolean(body.tunnelEnabled);
            this.db.setSetting('network_tunnel_enabled', String(this.tunnelEnabled));
        }

        if (body.tunnelProvider !== undefined) {
            const validProviders: TunnelProvider[] = ['cloudflare', 'ngrok', 'localtunnel', 'custom'];
            if (!validProviders.includes(body.tunnelProvider)) throw new Error(`Invalid tunnelProvider: ${body.tunnelProvider}`);
            this.tunnelProvider = body.tunnelProvider;
            this.db.setSetting('network_tunnel_provider', this.tunnelProvider);
        }

        if (body.tunnelConfig !== undefined && typeof body.tunnelConfig === 'object') {
            const incoming = body.tunnelConfig;
            if (incoming.authToken === '***') {
                incoming.authToken = this.tunnelConfig.authToken || '';
            }
            this.tunnelConfig = incoming;
            this.db.setSetting('network_tunnel_config', JSON.stringify(this.tunnelConfig));
        }

        return { needsRestart };
    }

    public shutdown(): void {
        this.stopTunnel();
    }
}
