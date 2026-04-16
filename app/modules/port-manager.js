'use strict';

const net = require('net');
const http = require('http');
const { execSync, execFileSync } = require('child_process');
const logger = require('./logger');

/**
 * PortManager - Intelligentes Port-Management für LTTH
 *
 * Strategie:
 * 1. Prüfe ob bevorzugter Port frei ist → nutze ihn
 * 2. Falls belegt: Prozess-PID ermitteln und gnadenlos killen (wenn nicht self)
 * 3. Falls keine PID ermittelbar (z.B. TIME_WAIT): hartnäckig warten bis Port frei ist
 */
class PortManager {
  constructor(options = {}) {
    this.preferredPort = options.preferredPort || 3000;
    this.healthEndpoint = options.healthEndpoint || '/api/health';
    this.appIdentifier = options.appIdentifier || 'ltth';
    this.killTimeout = options.killTimeout || 5000;
  }

  /**
   * Prüft ob ein Port frei ist
   * @param {number} port
   * @returns {Promise<boolean>}
   */
  isPortFree(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => {
        resolve(false);
      });
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '0.0.0.0');
    });
  }

  /**
   * Prüft ob auf einem Port eine LTTH-Instanz läuft
   * Erkennung über den Health-Endpoint oder Dashboard-Response
   * @param {number} port
   * @returns {Promise<{isLTTH: boolean, pid: number|null}>}
   */
  checkIfLTTHInstance(port) {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/api/health`, {
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
          } catch (e) {
            // Kein JSON → kein LTTH
          }
          resolve({ isLTTH: false, pid: null });
        });
      });

      req.on('error', () => {
        // Verbindung fehlgeschlagen → Fallback: Dashboard prüfen
        this._checkDashboard(port).then(resolve);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ isLTTH: false, pid: null });
      });
    });
  }

  /**
   * Fallback-Check über Dashboard-Seite
   * @param {number} port
   * @returns {Promise<{isLTTH: boolean, pid: number|null}>}
   */
  _checkDashboard(port) {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/dashboard.html`, {
        timeout: 3000
      }, (res) => {
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

  /**
   * Findet die PID des Prozesses, der einen bestimmten Port belegt
   * Plattformübergreifend: Windows, Linux, macOS
   * @param {number} port
   * @returns {number|null}
   */
  findPIDOnPort(port) {
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
          if (!isNaN(pid) && pid > 0) {
            return pid;
          }
        }
      } else {
        const output = execSync(`lsof -i :${port} -t`, {
          encoding: 'utf-8',
          timeout: 5000
        }).trim();

        if (!output) return null;

        const pid = parseInt(output.split('\n')[0], 10);
        if (!isNaN(pid) && pid > 0) {
          return pid;
        }
      }
    } catch (error) {
      logger.debug(`Could not find PID on port ${port}: ${error.message}`);
    }

    return null;
  }

  /**
   * Killt einen Prozess anhand seiner PID
   * @param {number} pid
   * @returns {Promise<boolean>}
   */
  async killProcess(pid) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      logger.warn(`Refusing to kill PID ${pid} (self or invalid)`);
      return false;
    }

    try {
      logger.info(`🔪 Killing old LTTH instance (PID: ${pid})...`);

      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
          encoding: 'utf-8',
          timeout: this.killTimeout,
          windowsHide: true
        });
      } else {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (e) {
          if (e.code === 'ESRCH') {
            logger.info(`Process ${pid} already terminated`);
            return true;
          }
          throw e;
        }

        const terminated = await this._waitForProcessExit(pid, 3000);
        if (!terminated) {
          logger.warn(`Process ${pid} did not exit gracefully, sending SIGKILL...`);
          try {
            process.kill(pid, 'SIGKILL');
          } catch (e) {
            if (e.code !== 'ESRCH') throw e;
          }
        }
      }

      await this._waitForPortFree(this.preferredPort, this.killTimeout);

      logger.info(`✅ Old LTTH instance (PID: ${pid}) terminated successfully`);
      return true;

    } catch (error) {
      logger.error(`Failed to kill process ${pid}: ${error.message}`);
      return false;
    }
  }

  /**
   * Wartet bis ein Prozess beendet ist
   * @param {number} pid
   * @param {number} timeout
   * @returns {Promise<boolean>}
   */
  _waitForProcessExit(pid, timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        try {
          process.kill(pid, 0);
          if (Date.now() - start > timeout) {
            resolve(false);
          } else {
            setTimeout(check, 200);
          }
        } catch (e) {
          resolve(true);
        }
      };
      check();
    });
  }

  /**
   * Wartet bis ein Port frei ist
   * @param {number} port
   * @param {number} timeout
   * @returns {Promise<boolean>}
   */
  _waitForPortFree(port, timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = async () => {
        const free = await this.isPortFree(port);
        if (free) {
          resolve(true);
        } else if (Date.now() - start > timeout) {
          resolve(false);
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    });
  }

  /**
   * Hauptmethode: Erzwingt den bevorzugten Port.
   * Kein Fallback auf andere Ports.
   *
   * @returns {Promise<{port: number, action: string}>}
   */
  async resolvePort() {
    const preferred = this.preferredPort;
    let waitedForRelease = false;

    // Intentionally no max retry cap here: force-port-3000 architecture requires
    // waiting until the preferred port becomes available instead of falling back.
    while (true) {
      logger.info(`🔍 Checking if port ${preferred} is available...`);
      const isFree = await this.isPortFree(preferred);

      if (isFree) {
        logger.info(`✅ Port ${preferred} is available`);
        return { port: preferred, action: waitedForRelease ? 'waited_for_release' : 'direct' };
      }

      logger.warn(`⚠️  Port ${preferred} is in use, investigating...`);

      // PID lookup mit bis zu 3 Retries (Race-Condition-Schutz)
      let pid = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        pid = this.findPIDOnPort(preferred);
        if (pid) break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 300));
      }

      if (pid && pid !== process.pid) {
        logger.info(`🔄 Process on port ${preferred} detected (PID: ${pid}) – killing...`);
        const killed = await this.killProcess(pid);
        if (!killed) {
          logger.warn(`⚠️  Kill for PID ${pid} failed. Waiting for port release fallback...`);
        }
      } else if (pid === process.pid) {
        logger.warn(`⚠️  Port ${preferred} belongs to current process (PID: ${pid}) – waiting for release...`);
      } else {
        logger.info(`⏳ No PID found on port ${preferred} (possible TIME_WAIT). Waiting for release...`);
      }

      const nowFree = await this._waitForPortFree(preferred, this.killTimeout);
      if (nowFree) {
        logger.info(`✅ Port ${preferred} released after wait`);
        return { port: preferred, action: pid ? 'killed_old_instance' : 'waited_for_release' };
      }

      waitedForRelease = true;
      logger.warn(`⏳ Port ${preferred} still busy after wait window. Retrying...`);
    }
  }
}

module.exports = PortManager;
