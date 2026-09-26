import { WebSocket } from 'ws';
import logger from '../utils/logger.js';
import os from 'os';

const SCAN_TIMEOUT = parseInt(process.env.SCAN_TIMEOUT || '2000', 10); // 2s por probe
const PARALLEL_LIMIT = 20;

// Rutas WebSocket estándar - ORDENADAS por probabilidad de éxito
const PROBE_PATHS = [
  '/transmisor',  // 95% proyectos (Santiago, Robert, Andres, Jhonier, Diego)
  '/ws',          // 85% proyectos (Santiago, Robert, Diego)
  '/ws/peer',     // 70% proyectos (Diego compat)
  '/monitor',     // 60% proyectos (Santiago, Robert, Andres, Diego)
  '/ws-stomp',    // 10% proyectos (Jhonier)
  '/'             // Santiago fallback
];

// Rango por defecto: segmento COMPLETO 1-254
const DEFAULT_START_OCTET = parseInt(process.env.SCAN_START_OCTET || '1', 10);
const DEFAULT_END_OCTET = parseInt(process.env.SCAN_END_OCTET || '254', 10);

// Puerto WebSocket por defecto para escaneo (80, no el PORT del server)
const DEFAULT_SCAN_PORT = 80;

/**
 * Detecta TODOS los segmentos /24 privados propios del host
 * Retorna: ['192.168.1', '10.0.0', '10.144.191', '172.16.5', ...]
 * Solo redes privadas RFC 1918: 10.x, 192.168.x, 172.16-31.x
 * @returns {string[]}
 */
export function getOwnSegments() {
  const segments = new Set();
  
  try {
    const interfaces = os.networkInterfaces();
    for (const [, ifaces] of Object.entries(interfaces)) {
      for (const iface of ifaces || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            const [a, b, c] = parts.map(Number);
            // RFC 1918: 10.x, 192.168.x, 172.16-31.x
            const isPrivate = 
              (a === 10) ||
              (a === 192 && b === 168) ||
              (a === 172 && b >= 16 && b <= 31);
            
            if (isPrivate) {
              segments.add(`${a}.${b}.${c}`);
            }
          }
        }
      }
    }
  } catch (e) {
    // Silencioso, fallback abajo
  }
  
  // Fallback si no hay interfaces privadas
  return segments.size > 0 ? Array.from(segments) : ['192.168.0'];
}

/**
 * Obtiene el segmento principal (para compatibilidad)
 * @returns {string}
 */
export function getPrimarySegment() {
  const segments = getOwnSegments();
  return segments[0] || '192.168.0';
}

// Subnet por defecto: segmento primario detectado automáticamente
const DEFAULT_BASE_IP = process.env.SCAN_BASE_IP || getPrimarySegment();

/**
 * Escanea UNO o MÚLTIPLES segmentos /24 propios
 * @param {object} opts
 * @param {string|string[]} opts.baseIP - Segmento(s) base: '192.168.1' o ['192.168.1', '10.0.0']
 * @param {number} opts.startOctet - Octeto inicial (default: 1)
 * @param {number} opts.endOctet - Octeto final (default: 254)
 * @param {number} opts.port - Puerto WebSocket (default: 80)
 * @param {string} opts.excludeIP - IP a excluir de los resultados (ej: IP del carro)
 * @returns {Promise<{ available: {ip:string, path:string, segment:string}[], scanned: string[], segments: string[], baseIP: string }>}
 */
export async function scanNetwork({
  baseIP = DEFAULT_BASE_IP,
  startOctet = DEFAULT_START_OCTET,
  endOctet = DEFAULT_END_OCTET,
  port = DEFAULT_SCAN_PORT,
  excludeIP,
} = {}) {
  // Normalizar baseIP a array de segmentos
  const segments = Array.isArray(baseIP) ? baseIP : [baseIP];
  
  // Si baseIP no se pasó explícitamente, usar segmentos propios detectados
  const segmentsToScan = (baseIP === DEFAULT_BASE_IP && !process.env.SCAN_BASE_IP)
    ? getOwnSegments()
    : segments;

  logger.info('SCANNER', `Escaneando ${segmentsToScan.length} segmento(s): ${segmentsToScan.join(', ')}.${startOctet}-${endOctet} (paths: ${PROBE_PATHS.join(', ')})`);

  const allAvailable = [];
  const allScanned = [];

  // Escanear cada segmento secuencialmente (para no saturar red)
  for (const segment of segmentsToScan) {
    const ips = [];
    for (let i = startOctet; i <= endOctet; i++) {
      ips.push(`${segment}.${i}`);
    }

    logger.info('SCANNER', `Escaneando ${ips.length} IPs en ${segment}.${startOctet}-${endOctet} (paths: ${PROBE_PATHS.join(', ')})`);

    for (let i = 0; i < ips.length; i += PARALLEL_LIMIT) {
      const batch = ips.slice(i, i + PARALLEL_LIMIT);
      const results = await Promise.allSettled(
        batch.map((ip) => probeIP(ip, port))
      );

      results.forEach((result, index) => {
        const ip = batch[index];
        allScanned.push(ip);
        if (result.status === 'fulfilled' && result.value) {
          // Excluir IP del carro si se especificó
          if (excludeIP && ip === excludeIP) {
            logger.info('SCANNER', `${ip}:${port}${result.value} activo [${segment}] - EXCLUIDO (IP del carro)`);
          } else {
            allAvailable.push({ ip, path: result.value, segment });
            logger.info('SCANNER', `${ip}:${port}${result.value} activo [${segment}]`);
          }
        }
      });
    }
  }

  return { 
    available: allAvailable, 
    scanned: allScanned, 
    segments: segmentsToScan,
    baseIP: segmentsToScan[0] || '192.168.0'
  };
}

/**
 * Prueba si una IP tiene un receptor activo en algún path con AbortController y timeout
 * @param {string} ip
 * @param {number} port
 * @returns {Promise<string|null>} el path que funcionó, o null
 */
function probeIP(ip, port) {
  return new Promise((resolve) => {
    let resolved = false;
    const controller = new AbortController();
    const sockets = [];

    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(globalTimeout);
      try { controller.abort(); } catch (e) {}
      for (const s of sockets) {
        try { s.terminate(); } catch (e) {}
      }
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }, SCAN_TIMEOUT);

    for (const path of PROBE_PATHS) {
      if (resolved) break;

      try {
        const ws = new WebSocket(`ws://${ip}:${port}${path}`, { signal: controller.signal });
        sockets.push(ws);

        ws.on('open', () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(path);
          } else {
            try { ws.close(); } catch (e) {}
          }
        });

        ws.on('error', () => {
          // Si este path falla, se prueban los demás paths
        });
      } catch (err) {
        // En caso de fallo síncrono al instanciar
      }
    }

    // Fallback global
    const globalTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }, SCAN_TIMEOUT + 200);
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
