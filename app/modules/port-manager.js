'use strict';

const net = require('net');
const http = require('http');
const { execSync } = require('child_process');
const logger = require('./logger');

/**
 * PortManager - Intelligentes Port-Management für LTTH
 *
 * Strategie:
 * 1. Prüfe ob bevorzugter Port frei ist → nutze ihn
 * 2. Falls belegt: prüfe ob eine alte LTTH-Instanz auf dem Port läuft
 *    a) Wenn ja → alte Instanz killen, bevorzugten Port nutzen
 *    b) Wenn nein (fremder Prozess) → alternativen Port (3001-3009) suchen
 */
class PortManager {
  constructor(options = {}) {
    this.preferredPort = options.preferredPort || 3000;
    this.fallbackPorts = options.fallbackPorts || [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009];
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
    if (!pid || pid === process.pid) {
      logger.warn(`Refusing to kill PID ${pid} (self or invalid)`);
      return false;
    }

    try {
      logger.info(`🔪 Killing old LTTH instance (PID: ${pid})...`);

      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /F /T`, {
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
   * Hauptmethode: Findet den besten verfügbaren Port
   *
   * Ablauf:
   * 1. Bevorzugter Port frei? → Nutzen
   * 2. Belegt von alter LTTH-Instanz? → Killen, bevorzugten Port nutzen
   * 3. Belegt von fremdem Prozess? → Fallback-Port suchen
   *
   * @param {{excludePorts?: number[]}} [options]
   * @returns {Promise<{port: number, action: string}>}
   */
  async resolvePort(options = {}) {
    const preferred = this.preferredPort;
    const excludePorts = Array.isArray(options.excludePorts) ? options.excludePorts : [];
    const excluded = new Set(excludePorts.filter((port) => Number.isInteger(port) && port > 0));

    if (excluded.has(preferred)) {
      logger.warn(`⚠️  Preferred port ${preferred} is excluded, skipping direct check`);
    } else {
      logger.info(`🔍 Checking if port ${preferred} is available...`);
      const isFree = await this.isPortFree(preferred);

      if (isFree) {
        logger.info(`✅ Port ${preferred} is available`);
        return { port: preferred, action: 'direct' };
      }

      logger.warn(`⚠️  Port ${preferred} is in use, investigating...`);

      // PID lookup mit bis zu 3 Retries (Race-Condition-Schutz)
      let pid = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        pid = this.findPIDOnPort(preferred);
        if (pid) break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 300));
      }

      const { isLTTH } = await this.checkIfLTTHInstance(preferred);

      // Wenn PID bekannt: immer versuchen zu killen.
      // Beim Neustart nach Absturz ist es garantiert eine alte LTTH-Instanz.
      if (pid && pid !== process.pid) {
        logger.info(`🔄 Stale process on port ${preferred} (PID: ${pid}) – killing...`);
        const killed = await this.killProcess(pid);

        if (killed) {
          const nowFree = await this._waitForPortFree(preferred, this.killTimeout);
          if (nowFree) {
            logger.info(`✅ Port ${preferred} freed after killing stale process`);
            return { port: preferred, action: 'killed_old_instance' };
          }
          logger.warn(`⚠️  Port ${preferred} still blocked after kill – using fallback`);
        } else {
          logger.warn(`⚠️  Kill of PID ${pid} failed – using fallback`);
        }
      } else if (isLTTH && !pid) {
        // LTTH erkannt aber PID nicht ermittelbar (andere User, Berechtigungen)
        logger.warn(`⚠️  LTTH instance on port ${preferred} detected but PID unknown – using fallback port`);
      } else {
        logger.warn(`⚠️  Port ${preferred} blocked by unknown process, PID not determinable – using fallback`);
      }
    }

    // Fallback-Ports durchsuchen
    for (const fallbackPort of this.fallbackPorts) {
      if (excluded.has(fallbackPort)) {
        logger.debug(`Skipping excluded fallback port ${fallbackPort}`);
        continue;
      }
      const fallbackFree = await this.isPortFree(fallbackPort);
      if (fallbackFree) {
        logger.info(`✅ Using fallback port ${fallbackPort}`);
        return { port: fallbackPort, action: 'fallback' };
      }
      logger.debug(`Port ${fallbackPort} also in use, trying next...`);
    }

    const attemptedPorts = [preferred, ...this.fallbackPorts]
      .filter((port) => !excluded.has(port))
      .join(', ');
    throw new Error(`All ports (${attemptedPorts}) are in use. Cannot start server.`);
  }
}

module.exports = PortManager;
