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
   * @returns {Promise<{port: number, action: string}>}
   */
  async resolvePort() {
    const preferred = this.preferredPort;

    logger.info(`🔍 Checking if port ${preferred} is available...`);
    const isFree = await this.isPortFree(preferred);

    if (isFree) {
      logger.info(`✅ Port ${preferred} is available`);
      return { port: preferred, action: 'direct' };
    }

    logger.warn(`⚠️  Port ${preferred} is in use, investigating...`);

    const { isLTTH } = await this.checkIfLTTHInstance(preferred);
    const pid = this.findPIDOnPort(preferred);

    if (isLTTH && pid) {
      logger.info(`🔄 Old LTTH instance detected on port ${preferred} (PID: ${pid})`);
      const killed = await this.killProcess(pid);

      if (killed) {
        const nowFree = await this.isPortFree(preferred);
        if (nowFree) {
          logger.info(`✅ Port ${preferred} freed after killing old instance`);
          return { port: preferred, action: 'killed_old_instance' };
        } else {
          logger.warn(`⚠️  Port ${preferred} still in use after kill attempt`);
        }
      } else {
        logger.warn(`⚠️  Could not kill old LTTH instance (PID: ${pid})`);
      }
    } else if (isLTTH && !pid) {
      logger.warn(`⚠️  LTTH instance detected on port ${preferred} but PID could not be determined`);
      logger.warn('   → Searching for alternative port');
    } else {
      logger.info(`ℹ️  Port ${preferred} is used by another application (PID: ${pid || 'unknown'})`);
      logger.info('   → Searching for alternative port');
    }

    for (const fallbackPort of this.fallbackPorts) {
      const fallbackFree = await this.isPortFree(fallbackPort);
      if (fallbackFree) {
        logger.info(`✅ Using alternative port ${fallbackPort}`);
        return { port: fallbackPort, action: 'fallback' };
      }
      logger.debug(`Port ${fallbackPort} also in use, trying next...`);
    }

    throw new Error(`All ports (${preferred}, ${this.fallbackPorts.join(', ')}) are in use. Cannot start server.`);
  }
}

module.exports = PortManager;
