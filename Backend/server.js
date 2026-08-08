import http from 'http';
import os from 'os';
import { pathToFileURL } from 'url';
import { info, warn, error, success } from './src/utils/logger.js';
import { CarService } from './src/services/carService.js';
import { AuditService } from './src/services/auditService.js';
import { TransmisorService } from './src/services/transmisorService.js';
import { COMMAND_RANGE, codificarPrograma } from './src/core/encriptador.js';
import { COMMAND_MAP, MOVEMENT_COMMANDS, parseCommands } from './src/core/parser.js';

const COMPONENT = 'SERVER';
const PORT = process.env.PORT || 3000;
const DEFAULT_STEP_DELAY = 350;

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
  console.log(' ACCESS URLs');
  console.log(separator);
  console.log(` Frontend : http://${displayIp}:${frontendPort}`);
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

  const httpServer = http.createServer((req, res) => {
    handleRequest(req, res, { carService, auditService, transmisorService });
  });

  return { httpServer, carService, auditService, transmisorService };
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
  const path = url.pathname;
  const method = req.method;

  try {
    if (method === 'GET' && path === '/api/health') {
      return respond(res, 200, {
        status: 'ok',
        carConnected: ctx.carService.connected,
        carAddress: ctx.carService.address
      });
    }

    if (method === 'GET' && path === '/api/audit') {
      return respond(res, 200, { logs: ctx.auditService.getLogs() });
    }

    if (method === 'GET' && path === '/api/rangos') {
      return respond(res, 200, { rangos: COMMAND_RANGE });
    }

    if (method === 'GET' && path === '/api/comandos') {
      const comandos = Object.entries(COMMAND_MAP).map(([cmd, info]) => ({
        comando: cmd,
        nombre: info.name,
        esp32: info.esp32,
        tipo: info.type,
        aceptaRepeticion: MOVEMENT_COMMANDS.includes(cmd)
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

    if (method === 'GET' && path === '/api/events') {
      return handleEvents(res, ctx.auditService);
    }

    if (method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return respond(res, 400, { ok: false, error: err.message });
      }

      if (path === '/api/connect') {
        const { ip, port } = body;
        if (!ip) {
          return respond(res, 400, { ok: false, error: 'La IP del carro es obligatoria' });
        }
        try {
          const result = await ctx.carService.connect(ip, port || 80);
          return respond(res, 200, result);
        } catch (err) {
          return respond(res, 502, { ok: false, error: err.message });
        }
      }

      if (path === '/api/disconnect') {
        ctx.carService.disconnect();
        return respond(res, 200, { ok: true, status: 'disconnected' });
      }

      if (path === '/api/program') {
        if (typeof body.program !== 'string') {
          return respond(res, 400, { ok: false, error: 'El campo "program" es obligatorio' });
        }
        const result = ctx.transmisorService.executeProgram(body.program);
        return respond(res, result.status, result);
      }

      if (path === '/api/codificar') {
        if (typeof body.program !== 'string' || body.program.trim() === '') {
          return respond(res, 400, { ok: false, valid: false, errors: ['El campo "program" es obligatorio'], commands: [] });
        }

        const parsed = parseCommands(body.program);

        if (!parsed.valid) {
          return respond(res, 400, { ok: false, valid: false, errors: parsed.errors, commands: parsed.commands });
        }

        const encoded = codificarPrograma(parsed.commands);

        return respond(res, 200, {
          ok: true,
          valid: true,
          program: parsed.raw,
          numeroUnico: encoded.numeroUnico,
          bloques: encoded.bloques,
          totalSteps: encoded.bloques.length
        });
      }

      if (path === '/api/programa-numeros') {
        if (typeof body.programa !== 'string' || body.programa.trim() === '') {
          return respond(res, 400, { ok: false, valid: false, errors: ['El campo "programa" debe ser un string no vacío'], decoded: [], bloques: [] });
        }
        const result = ctx.transmisorService.executeEncodedProgram(body.programa.trim());
        return respond(res, result.status, result);
      }

      if (path === '/api/command') {
        if (!body.command) {
          return respond(res, 400, { ok: false, error: 'El campo "command" es obligatorio' });
        }
        const result = ctx.transmisorService.executeCommand(body.command, body.repetitions);
        return respond(res, result.status, result);
      }

      if (path === '/api/raw') {
        if (!body.char || typeof body.char !== 'string') {
          return respond(res, 400, { ok: false, error: 'El campo "char" es obligatorio' });
        }
        const result = ctx.transmisorService.sendRawChar(body.char);
        return respond(res, result.status, result);
      }

      if (path === '/api/classify') {
        const result = ctx.transmisorService.classifyNumber(body.number);
        return respond(res, result.status, result);
      }
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
