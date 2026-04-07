import net from 'net';
import http from 'http';
import { execSync } from 'child_process';
import { ILogger } from './LoggerService';

export interface PortOptions {
    preferredPort?: number;
    fallbackPorts?: number[];
    healthEndpoint?: string;
    appIdentifier?: string;
    killTimeout?: number;
}

export interface PortResolution {
    port: number;
    action: 'direct' | 'killed_old_instance' | 'fallback';
}

export class PortService {
    private readonly preferredPort: number;
    private readonly fallbackPorts: number[];
    private readonly healthEndpoint: string;
    private readonly appIdentifier: string;
    private readonly killTimeout: number;

    constructor(
        private readonly logger: ILogger,
        options: PortOptions = {}
    ) {
        this.preferredPort = options.preferredPort || 3000;
        this.fallbackPorts = options.fallbackPorts || [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009];
        this.healthEndpoint = options.healthEndpoint || '/api/health';
        this.appIdentifier = options.appIdentifier || 'ltth';
        this.killTimeout = options.killTimeout || 5000;
    }

    public isPortFree(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => server.close(() => resolve(true)));
            server.listen(port, '0.0.0.0');
        });
    }

    public async checkIfLTTHInstance(port: number): Promise<{ isLTTH: boolean; pid: number | null }> {
        return new Promise((resolve) => {
            const req = http.get(`http://localhost:${port}${this.healthEndpoint}`, {
                timeout: 3000,
                headers: { 'Accept': 'application/json' }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.status === 'ok' || json.success === true ||
                            (json.name && (json.name.includes('TikTok') || json.name.includes('LTTH')))) {
                            resolve({ isLTTH: true, pid: json.pid || null });
                            return;
                        }
                    } catch { /* Not JSON */ }
                    resolve({ isLTTH: false, pid: null });
                });
            });

            req.on('error', () => {
                this.checkDashboard(port).then(resolve);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ isLTTH: false, pid: null });
            });
        });
    }

    private checkDashboard(port: number): Promise<{ isLTTH: boolean; pid: number | null }> {
        return new Promise((resolve) => {
            const req = http.get(`http://localhost:${port}/dashboard.html`, { timeout: 3000 }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (data.includes('TikTok Helper') || data.includes('ltth') || data.includes('Pup Cid')) {
                        resolve({ isLTTH: true, pid: null });
                    } else {
                        resolve({ isLTTH: false, pid: null });
                    }
                });
            });
            req.on('error', () => resolve({ isLTTH: false, pid: null }));
            req.on('timeout', () => {
                req.destroy();
                resolve({ isLTTH: false, pid: null });
            });
        });
    }

    public findPIDOnPort(port: number): number | null {
        try {
            if (process.platform === 'win32') {
                const output = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, {
                    encoding: 'utf-8',
                    timeout: 5000,
                    windowsHide: true
                }).trim();

                if (!output) return null;

                const lines = output.split('\n');
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[parts.length - 1], 10);
                    if (!isNaN(pid) && pid > 0) return pid;
                }
            } else {
                const output = execSync(`lsof -i :${port} -t`, {
                    encoding: 'utf-8',
                    timeout: 5000
                }).trim();

                if (!output) return null;
                const pid = parseInt(output.split('\n')[0], 10);
                if (!isNaN(pid) && pid > 0) return pid;
            }
        } catch (error: any) {
            this.logger.debug(`Could not find PID on port ${port}: ${error.message}`);
        }
        return null;
    }

    public async killProcess(pid: number): Promise<boolean> {
        if (!pid || pid === process.pid) {
            this.logger.warn(`Refusing to kill PID ${pid} (self or invalid)`);
            return false;
        }

        try {
            this.logger.info(`🔪 Killing old LTTH instance (PID: ${pid})...`);

            if (process.platform === 'win32') {
                execSync(`taskkill /PID ${pid} /F /T`, {
                    encoding: 'utf-8',
                    timeout: this.killTimeout,
                    windowsHide: true
                });
            } else {
                try {
                    process.kill(pid, 'SIGTERM');
                } catch (e: any) {
                    if (e.code === 'ESRCH') return true;
                    throw e;
                }

                const terminated = await this.waitForProcessExit(pid, 3000);
                if (!terminated) {
                    this.logger.warn(`Process ${pid} did not exit gracefully, sending SIGKILL...`);
                    try { process.kill(pid, 'SIGKILL'); } catch (e: any) {
                        if (e.code !== 'ESRCH') throw e;
                    }
                }
            }

            await this.waitForPortFree(this.preferredPort, this.killTimeout);
            this.logger.info(`✅ Old LTTH instance (PID: ${pid}) terminated successfully`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to kill process ${pid}: ${error.message}`);
            return false;
        }
    }

    private waitForProcessExit(pid: number, timeout: number): Promise<boolean> {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                try {
                    process.kill(pid, 0);
                    if (Date.now() - start > timeout) resolve(false);
                    else setTimeout(check, 200);
                } catch { resolve(true); }
            };
            check();
        });
    }

    private waitForPortFree(port: number, timeout: number): Promise<boolean> {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = async () => {
                const free = await this.isPortFree(port);
                if (free) resolve(true);
                else if (Date.now() - start > timeout) resolve(false);
                else setTimeout(check, 300);
            };
            check();
        });
    }

    public async resolvePort(): Promise<PortResolution> {
        const preferred = this.preferredPort;

        this.logger.info(`Searching for available port, starting with ${preferred}...`);
        const isFree = await this.isPortFree(preferred);

        if (isFree) {
            this.logger.info(`✅ Port ${preferred} is available`);
            return { port: preferred, action: 'direct' };
        }

        this.logger.warn(`⚠️  Port ${preferred} is in use, investigating...`);

        const { isLTTH } = await this.checkIfLTTHInstance(preferred);
        const pid = this.findPIDOnPort(preferred);

        if (isLTTH && pid) {
            this.logger.info(`🔄 Old LTTH instance detected on port ${preferred} (PID: ${pid})`);
            const killed = await this.killProcess(pid);

            if (killed) {
                const nowFree = await this.isPortFree(preferred);
                if (nowFree) {
                    this.logger.info(`✅ Port ${preferred} freed after killing old instance`);
                    return { port: preferred, action: 'killed_old_instance' };
                }
            }
        }

        for (const fallbackPort of this.fallbackPorts) {
            if (await this.isPortFree(fallbackPort)) {
                this.logger.info(`✅ Using alternative port ${fallbackPort}`);
                return { port: fallbackPort, action: 'fallback' };
            }
        }

        throw new Error(`All ports (${preferred}, ${this.fallbackPorts.join(', ')}) are in use. Cannot start server.`);
    }
}
