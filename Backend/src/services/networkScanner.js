import { WebSocket } from 'ws';
import logger from '../utils/logger.js';
import os from 'os';
import { EXCLUDED_CAR_IPS } from '../config/constants.js';

const SCAN_TIMEOUT = parseInt(process.env.SCAN_TIMEOUT || '2000', 10); // 2s por probe
const PARALLEL_LIMIT = 20;

// Sondeo principal: GET http://ip/estado (JSON trivial, suele responder en <100ms).
// Trae nombre del equipo, ocupación (transmisores) y estado del carro.
const ESTADO_TIMEOUT = parseInt(process.env.SCAN_ESTADO_TIMEOUT || '1200', 10);
// Path WS por defecto cuando detectamos el receptor por /estado (no expone su WS).
const DEFAULT_WS_PATH = '/transmisor';

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
 * Obtiene todas las IPs IPv4 propias (no loopback) de la máquina
 * @returns {string[]}
 */
export function getOwnIPs() {
  const ownIPs = new Set();
  try {
    const interfaces = os.networkInterfaces();
    for (const [, ifaces] of Object.entries(interfaces)) {
      for (const iface of ifaces || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ownIPs.add(iface.address);
        }
      }
    }
  } catch {
    // Silencioso
  }
  return Array.from(ownIPs);
}

const OWN_HOSTNAME = os.hostname().trim().toLowerCase();

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
 * @returns {Promise<{ available: {ip:string, port:number, path:string, nombre:string|null, robot:string|null, transmisores:number|null, occupied:boolean, advertised:boolean, segment:string}[], scanned: string[], segments: string[], baseIP: string }>}
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

  const ownIPs = new Set(getOwnIPs());
  const carIPs = new Set(EXCLUDED_CAR_IPS);
  if (excludeIP) {
    if (Array.isArray(excludeIP)) excludeIP.forEach(ip => carIPs.add(ip));
    else carIPs.add(excludeIP);
  }

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
        batch.map((ip) => {
          if (ownIPs.has(ip)) {
            logger.info('SCANNER', `${ip} [${segment}] - EXCLUIDO (IP propia)`);
            return Promise.resolve(null);
          }
          if (carIPs.has(ip)) {
            logger.info('SCANNER', `${ip} [${segment}] - EXCLUIDO (IP del carro/cámara)`);
            return Promise.resolve(null);
          }
          return probeIP(ip, port);
        })
      );

      results.forEach((result, index) => {
        const ip = batch[index];
        allScanned.push(ip);
        if (result.status === 'fulfilled' && result.value) {
          const detalle = result.value;
          const effectivePort = detalle.port || port;
          const deviceNameLower = detalle.nombre ? detalle.nombre.trim().toLowerCase() : '';
          const isOwnHost = deviceNameLower && (deviceNameLower === OWN_HOSTNAME || deviceNameLower === 'zandevistan');

          if (ownIPs.has(ip) || isOwnHost) {
            logger.info('SCANNER', `${ip}:${effectivePort}${detalle.path} activo [${segment}] - EXCLUIDO (dispositivo propio${detalle.nombre ? ': ' + detalle.nombre : ''})`);
          } else if (carIPs.has(ip)) {
            logger.info('SCANNER', `${ip}:${effectivePort}${detalle.path} activo [${segment}] - EXCLUIDO (IP del carro)`);
          } else {
            allAvailable.push({ ip, ...detalle, segment });
            const nombreTag = detalle.nombre ? ` ${detalle.nombre} ·` : '';
            const ocupadoTag = detalle.occupied ? ' [ocupado]' : '';
            logger.info('SCANNER', `${ip}:${effectivePort}${detalle.path} activo [${segment}]${nombreTag}${ocupadoTag}`);
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
 * Deriva el endpoint WebSocket anunciado por un receptor a partir de su JSON
 * de /estado. Prioriza el primer `direcciones[]` o `misDirecciones[]` que sea
 * ws://|wss://. (NO usa `robotUrl` porque ese campo apunta al carro ESP32).
 * Si nada se anuncia, usa el path y puerto por defecto (/transmisor).
 * @param {object} data - JSON de /estado
 * @param {number} [fallbackPort] - puerto a usar cuando no hay anuncio
 * @returns {{ advertised: boolean, host: string|null, port: number, path: string, url: string|null }}
 */
export function parseAdvertisedEndpoint(data, fallbackPort = DEFAULT_SCAN_PORT) {
  let raw = null;
  if (data && Array.isArray(data.direcciones)) {
    for (const d of data.direcciones) {
      if (typeof d === 'string' && /^wss?:\/\//i.test(d)) { raw = d; break; }
    }
  }
  if (!raw && data && Array.isArray(data.misDirecciones)) {
    for (const d of data.misDirecciones) {
      const candidate = d && typeof d === 'object' ? (d.wsTransmisor || d.wsPeer) : d;
      if (typeof candidate === 'string' && /^wss?:\/\//i.test(candidate)) { raw = candidate; break; }
    }
  }

  if (!raw) {
    return { advertised: false, host: null, port: fallbackPort, path: DEFAULT_WS_PATH, url: null };
  }

  try {
    const u = new URL(raw);
    const port = u.port ? Number(u.port) : (u.protocol === 'wss:' ? 443 : 80);
    const path = u.pathname || DEFAULT_WS_PATH;
    return {
      advertised: true,
      host: u.hostname,
      port,
      path,
      url: `${u.protocol}//${u.hostname}:${port}${path}`,
    };
  } catch {
    return { advertised: false, host: null, port: fallbackPort, path: DEFAULT_WS_PATH, url: null };
  }
}

/**
 * Sondea GET http://ip:port/estado. Si responde un JSON válido, devuelve los
 * datos ricos del receptor (nombre del equipo, estado del carro, ocupación) y
 * el endpoint WebSocket efectivo que anuncia (path + port).
 * Si no responde /estado (p.ej. un receptor que solo expone WebSocket), null.
 * @param {string} ip
 * @param {number} port
 * @returns {Promise<{port:number, path:string, nombre:string|null, robot:string|null, transmisores:number|null, occupied:boolean, advertised:boolean}|null>}
 */
export async function probeEstado(ip, port) {
  try {
    const res = await fetch(`http://${ip}:${port}/estado`, {
      signal: AbortSignal.timeout(ESTADO_TIMEOUT),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object' || typeof data.robot !== 'string') return null;

    const transmisores = typeof data.transmisores === 'number' ? data.transmisores : 0;
    const nombre = typeof data.nombre === 'string' && data.nombre.trim() ? data.nombre.trim() : null;
    const endpoint = parseAdvertisedEndpoint(data, port);
    return {
      path: endpoint.path,
      port: endpoint.port,
      nombre,
      robot: data.robot,
      transmisores,
      occupied: Boolean(data.occupied) || transmisores >= 1 || data.rol === 'transmisor',
      advertised: endpoint.advertised,
    };
  } catch {
    return null;
  }
}

/**
 * Prueba si una IP tiene un receptor activo en algún path WebSocket. Fallback
 * para receptores que no exponen /estado; detecta el path que responde.
 * @param {string} ip
 * @param {number} port
 * @returns {Promise<string|null>} el path que funcionó, o null
 */
function probeWebSocket(ip, port) {
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
 * Prueba una IP: primero /estado (datos ricos sin abrir WebSocket) y, si no
 * responde, cae al sondeo WebSocket clásico.
 * @param {string} ip
 * @param {number} port
 * @returns {Promise<{port:number, path:string, nombre:string|null, robot:string|null, transmisores:number|null, occupied:boolean, advertised:boolean}|null>}
 */
async function probeIP(ip, port) {
  const porEstado = await probeEstado(ip, port);
  if (porEstado) return porEstado;

  const path = await probeWebSocket(ip, port);
  if (!path) return null;
  return { path, port, nombre: null, robot: null, transmisores: null, occupied: false, advertised: false };
}

/**
 * Elige una IP al azar de la lista de disponibles
 */
export function pickRandom(availableIPs) {
  if (!availableIPs || availableIPs.length === 0) return null;
  const index = Math.floor(Math.random() * availableIPs.length);
  return availableIPs[index];
}
