import { WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import logger from '../utils/logger.js';

const SCAN_TIMEOUT = 800;
const PARALLEL_LIMIT = 20;
const PROBE_PATHS = ['/transmisor', '/ws', '/ws/peer'];

/**
 * Detecta el subnet local (ej: "192.168.0" o "192.168.1")
 */
function detectLocalSubnet() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
      }
    }
  }
  return '192.168.0';
}

/**
 * Escanea un rango de IPs buscando receptores activos en cualquier path
 * @param {object} opts
 * @param {string} opts.baseIP - IP base (default: detecta automáticamente)
 * @param {number} opts.startOctet - octeto inicial (default: 1)
 * @param {number} opts.endOctet - octeto final (default: 254)
 * @param {number} opts.port - puerto WebSocket (default: 80)
 * @returns {Promise<{ available: {ip:string, path:string}[], scanned: string[], baseIP: string }>}
 */
export async function scanNetwork({
  baseIP,
  startOctet = 1,
  endOctet = 254,
  port = 80,
} = {}) {
  const resolvedBase = baseIP || detectLocalSubnet();
  const ips = [];
  for (let i = startOctet; i <= endOctet; i++) {
    ips.push(`${resolvedBase}.${i}`);
  }

  logger.info('SCANNER', `Escaneando ${ips.length} IPs en ${resolvedBase}.${startOctet}-${endOctet} (paths: ${PROBE_PATHS.join(', ')})`);

  const available = [];
  const scanned = [];

  for (let i = 0; i < ips.length; i += PARALLEL_LIMIT) {
    const batch = ips.slice(i, i + PARALLEL_LIMIT);
    const results = await Promise.allSettled(
      batch.map((ip) => probeIP(ip, port))
    );

    results.forEach((result, index) => {
      const ip = batch[index];
      scanned.push(ip);
      if (result.status === 'fulfilled' && result.value) {
        available.push({ ip, path: result.value });
        logger.info('SCANNER', `${ip}:${port}${result.value} activo`);
      }
    });
  }

  return { available, scanned, baseIP: resolvedBase };
}

/**
 * Prueba si una IP tiene un receptor activo en algún path
 * @returns {Promise<string|null>} el path que funcionó, o null
 */
function probeIP(ip, port) {
  return new Promise((resolve) => {
    let resolved = false;

    for (const path of PROBE_PATHS) {
      if (resolved) return;

      const url = `ws://${ip}:${port}${path}`;
      const ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        if (!resolved) {
          ws.terminate();
        }
      }, SCAN_TIMEOUT);

      ws.on('open', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          resolve(path);
        } else {
          ws.close();
        }
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        if (!resolved) {
          // Si este path falló, ya probamos los demás en el loop
        }
      });
    }

    // Si ningún path funcionó después del timeout
    const globalTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, SCAN_TIMEOUT + 200);

    // Override resolve para limpiar el timeout global
    const origResolve = resolve;
    resolve = (val) => {
      clearTimeout(globalTimeout);
      origResolve(val);
    };
  });
}

/**
 * Elige una IP al azar de la lista de disponibles
 */
export function pickRandom(availableIPs) {
  if (!availableIPs || availableIPs.length === 0) return null;
  const index = Math.floor(Math.random() * availableIPs.length);
  return availableIPs[index];
}
