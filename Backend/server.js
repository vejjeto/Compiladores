import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { tablaService } from './src/services/tablaService.js';
import os from 'os';
import { info, warn, error, success } from './src/utils/logger.js';
import logger from './src/utils/logger.js';
import { CarService } from './src/services/carService.js';
import { AuditService } from './src/services/auditService.js';
import { TransmisorService } from './src/services/transmisorService.js';
import * as encriptador from './src/core/encriptador.js';
import { HANDLERS } from './src/http/handlers.js';
import { WsServerAdapter } from './src/adapters/wsServerAdapter.js';
import { PeerAdapter } from './src/adapters/peerAdapter.js';

const COMPONENT = 'SERVER';
const PORT = process.env.PORT || 80;
const DEFAULT_STEP_DELAY = 350;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_PATH = path.join(__dirname, '../Frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function getLocalIpv4Addresses() {
  const ifaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

function printAccessUrls() {
  const ips = getLocalIpv4Addresses();
  const displayIp = ips[0];
  const frontendPort = process.env.FRONTEND_PORT || 8080;
  const separator = '='.repeat(60);

  console.log('');
  console.log(separator);
  console.log(' ACCESS URLs (Frontend + API unificados)');
  console.log(separator);
  console.log(` Web App  : http://${displayIp}:${PORT}`);
  console.log(` API      : http://${displayIp}:${PORT}`);
  console.log(` Health   : http://${displayIp}:${PORT}/api/health`);
  console.log(` Local IPs: ${ips.join(', ')}`);
  console.log('');
  console.log(' Open the Frontend URL on another PC (PC2) to control the robot from there.');
  console.log(separator);
  console.log('');
}

export function createApp(options = {}) {
  const stepDelay = options.stepDelay ?? DEFAULT_STEP_DELAY;

  const carService = new CarService();
  const auditService = new AuditService();
  const transmisorService = new TransmisorService({
    carService,
    auditService,
    stepDelay,
    ackTimeout: options.ackTimeout,
    maxRetries: options.maxRetries
  });
  const peerAdapter = new PeerAdapter({ ctx: { carService, auditService, transmisorService } });

  carService.on('status', ({ status, ip, port }) => {
    auditService.broadcast('CAR_STATUS', {
      status,
      ip,
      port,
      timestamp: new Date().toISOString()
    });
  });

  carService.on('message', (message) => {
    auditService.broadcast('CAR_MESSAGE', {
      message,
      timestamp: new Date().toISOString()
    });
  });

  const ctx = { carService, auditService, transmisorService, encriptador, peerAdapter };

  const httpServer = http.createServer((req, res) => {
    handleRequest(req, res, ctx);
  });

  const wsServer = new WsServerAdapter({ server: httpServer, ctx, logger });
  wsServer.start();

  auditService.subscribe(({ type, data }) => {
    wsServer.broadcast(type, data);
  });

  return { httpServer, carService, auditService, transmisorService, wsServer };
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function respond(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function respondResult(res, result) {
  respond(res, result.status, result.data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Cuerpo de request demasiado grande'));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON inválido en el cuerpo del request'));
      }
    });

    req.on('error', reject);
  });
}

function handleEvents(res, auditService) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(': conectado\n\n');

  const unsubscribe = auditService.subscribe(({ type, data }) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  });

  res.on('close', unsubscribe);
}

async function handleRequest(req, res, ctx) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const reqPath = url.pathname;
  const method = req.method;

  try {
    if (method === 'GET' && reqPath === '/api/health') {
      return respondResult(res, await HANDLERS.health(ctx, {}));
    }

    if (method === 'GET' && reqPath === '/api/peer-status') {
      return respondResult(res, await HANDLERS['peer-status'](ctx, {}));
    }

    if (method === 'GET' && reqPath === '/api/audit') {
      return respondResult(res, await HANDLERS.audit(ctx, {}));
    }

    if (method === 'GET' && reqPath === '/api/rangos') {
      return respondResult(res, await HANDLERS.rangos(ctx, {}));
    }

    if (method === 'GET' && reqPath === '/api/comandos') {
      const commandsObj = tablaService.getAllCommands();
      const comandos = Object.entries(commandsObj).map(([cmd, info]) => ({
        comando: cmd,
        nombre: info.name,
        esp32: info.esp32,
        tipo: info.type,
        aceptaRepeticion: info.type === 'movement'
      }));
      return respond(res, 200, {
        comandos,
        reglas: [
          "'N' (Encender Cámara) debe ser el primer comando",
          "'P' (Apagar Cámara) debe ser el último comando",
          "Repetición (X:n) solo en movimientos: F, B, R, L"
        ]
      });
    }

    if (method === 'GET' && reqPath === '/api/events') {
      return handleEvents(res, ctx.auditService);
    }

    if (method === 'GET' && reqPath === '/api/grafo') {
      const numero = parseInt(url.searchParams.get('numero'), 10);
      const primo = parseInt(url.searchParams.get('primo'), 10);
      
      if (!numero || !primo) {
        return respond(res, 400, { ok: false, error: 'Faltan parámetros numero y primo' });
      }
      
      // Import dynamic to avoid circular dependencies if any, or use from ctx
      const { getAutomatonTransitions } = await import('./src/core/automatas.js');
      const result = getAutomatonTransitions(numero, primo);
      return respond(res, 200, { ok: true, status: 200, data: result, error: null });
    }

    if (method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return respond(res, 400, { ok: false, error: err.message });
      }

      const routeHandlers = {
        '/api/connect': HANDLERS.connect,
        '/api/disconnect': HANDLERS.disconnect,
        '/api/program': HANDLERS.program,
        '/api/codificar': HANDLERS.codificar,
        '/api/programa-numeros': HANDLERS['programa-numeros'],
        '/api/command': HANDLERS.command,
        '/api/raw': HANDLERS.raw,
        '/api/classify': HANDLERS.classify,
        '/api/connect-peer': HANDLERS['connect-peer'],
        '/api/disconnect-peer': HANDLERS['disconnect-peer'],
        '/api/peer-status': HANDLERS['peer-status'],
        '/api/connect-car-peer': HANDLERS['connect-car-peer']
      };

      const handler = routeHandlers[reqPath];

      if (handler) {
        return respondResult(res, await handler(ctx, body));
      }
    }

    // Si no es API ni WS, servimos el Frontend estático
    if (!reqPath.startsWith('/api/') && !reqPath.startsWith('/ws/')) {
      let filePath = reqPath === '/' ? '/index.html' : reqPath;
      filePath = path.join(FRONTEND_PATH, filePath);

      const resolvedPath = path.resolve(filePath);
      const rootPath = path.resolve(FRONTEND_PATH);
      if (!resolvedPath.startsWith(rootPath + path.sep) && resolvedPath !== rootPath) {
        res.writeHead(403);
        res.end('Acceso denegado');
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          if (err.code === 'ENOENT') {
            fs.readFile(path.join(FRONTEND_PATH, 'index.html'), (e, d) => {
              if (e) {
                res.writeHead(500);
                res.end('Error del servidor');
                return;
              }
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(d);
            });
          } else {
            res.writeHead(500);
            res.end('Error del servidor');
          }
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
      return;
    }

    return respond(res, 404, { ok: false, error: 'Ruta no encontrada' });
  } catch (err) {
    error(COMPONENT, 'Error procesando request', { error: err.message });
    if (!res.headersSent) {
      return respond(res, 500, { ok: false, error: 'Error interno del servidor' });
    }
    res.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// Cargar tablas globalmente (síncrono para que tests y la app funcionen sin cambiar createApp)
tablaService.loadTableSync();

if (isMain) {
  const { httpServer, carService } = createApp();

  httpServer.listen(PORT, '0.0.0.0', () => {
    success(COMPONENT, `API HTTP → http://0.0.0.0:${PORT}`);
    info(COMPONENT, 'Rutas disponibles:');
    info(COMPONENT, '  POST /api/connect     - Conectar al carro (WebSocket)');
    info(COMPONENT, '  POST /api/program     - Ejecutar programa de comandos');
    info(COMPONENT, '  POST /api/codificar   - Codificar programa de comandos a número único');
    info(COMPONENT, '  POST /api/programa-numeros - Ejecutar programa encriptado (número único)');
    info(COMPONENT, '  POST /api/command     - Comando individual');
    info(COMPONENT, '  POST /api/raw         - Enviar char crudo al carro');
    info(COMPONENT, '  POST /api/classify    - Clasificar un número');
    info(COMPONENT, '  GET  /api/rangos      - Rangos de números autorizados por comando');
    info(COMPONENT, '  GET  /api/comandos    - Comandos disponibles y sus reglas');
    info(COMPONENT, '  GET  /api/audit       - Log de auditoría acumulado');
    info(COMPONENT, '  GET  /api/events      - Eventos SSE (streaming)');
    info(COMPONENT, '  GET  /api/health      - Estado del servidor');
    info(COMPONENT, '  WS   /ws/api          - API WebSocket híbrida');
    info(COMPONENT, `CORS habilitado (*) - escuchando en todas las interfaces para red local`);
    printAccessUrls();
  });

  function closeAll() {
    warn(COMPONENT, 'Cerrando servidor...');
    carService.disconnect();
    httpServer.close(() => {
      success(COMPONENT, 'Servidor cerrado correctamente');
      process.exit(0);
    });
  }

  process.on('SIGINT', closeAll);
  process.on('SIGTERM', closeAll);
}
