import { WebSocket } from 'ws';
import logger from '../utils/logger.js';

const SCAN_TIMEOUT = parseInt(process.env.SCAN_TIMEOUT || '3000', 10);
const PARALLEL_LIMIT = 20;
// Solo el path real de conexión para evitar falsos positivos
const PROBE_PATHS = ['/ws/peer'];

// Rango por defecto optimizado: 100-200 (101 IPs = ~16s vs 39s del rango completo)
// Cubre la mayoría de dispositivos domésticos. Se puede limitar con SCAN_START_OCTET y SCAN_END_OCTET.
const DEFAULT_START_OCTET = parseInt(process.env.SCAN_START_OCTET || '100', 10);
const DEFAULT_END_OCTET = parseInt(process.env.SCAN_END_OCTET || '200', 10);

// Subnet por defecto: 192.168.0 (la usada por todos los proyectos)
// Se puede sobrescribir con SCAN_BASE_IP o parámetro baseIP
const DEFAULT_BASE_IP = process.env.SCAN_BASE_IP || '192.168.0';

/**
 * Puerto WebSocket por defecto para escaneo (80, no el PORT del server)
 * Los proyectos corren en puerto 80 por defecto
 */
const DEFAULT_SCAN_PORT = 80;

/**
 * Escanea un rango de IPs buscando receptores activos en cualquier path
 * @param {object} opts
 * @param {string} opts.baseIP - IP base (default: 192.168.0, sobrescribible con SCAN_BASE_IP env)
 * @param {number} opts.startOctet - octeto inicial (default: 1)
 * @param {number} opts.endOctet - octeto final (default: 254)
 * @param {number} opts.port - puerto WebSocket (default: 80, puerto estándar de los proyectos)
 * @returns {Promise<{ available: {ip:string, path:string}[], scanned: string[], baseIP: string }>}
 */
export async function scanNetwork({
  baseIP = DEFAULT_BASE_IP,
  startOctet = DEFAULT_START_OCTET,
  endOctet = DEFAULT_END_OCTET,
  port = DEFAULT_SCAN_PORT,
} = {}) {
  const ips = [];
  for (let i = startOctet; i <= endOctet; i++) {
    ips.push(`${baseIP}.${i}`);
  }

  logger.info('SCANNER', `Escaneando ${ips.length} IPs en ${baseIP}.${startOctet}-${endOctet} (paths: ${PROBE_PATHS.join(', ')})`);

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

  return { available, scanned, baseIP };
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
