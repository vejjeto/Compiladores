import { parseCommands } from '../core/parser.js';
import http from 'http';

const CAMERA_IP = '192.168.0.51';
const CAMERA_STREAM = `http://${CAMERA_IP}`;

async function health(ctx) {
  return {
    ok: true,
    status: 200,
    data: {
      status: 'ok',
      carConnected: ctx.carService.connected,
      carAddress: ctx.carService.address,
      cameraAddress: CAMERA_IP,
      cameraStream: CAMERA_STREAM
    },
    error: null
  };
}

async function rangos(ctx) {
  return {
    ok: true,
    status: 200,
    data: { rangos: ctx.encriptador.COMMAND_RANGE },
    error: null
  };
}

async function connect(ctx, body) {
  const { ip, port } = body;

  if (!ip) {
    return {
      ok: false,
      status: 400,
      data: { ok: false, error: 'La IP del carro es obligatoria' },
      error: 'La IP del carro es obligatoria'
    };
  }

  try {
    const result = await ctx.carService.connect(ip, port || 80);
    return { ok: true, status: 200, data: result, error: null };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: { ok: false, error: err.message },
      error: err.message
    };
  }
}

async function disconnect(ctx) {
  ctx.carService.disconnect();
  return {
    ok: true,
    status: 200,
    data: { ok: true, status: 'disconnected' },
    error: null
  };
}

async function program(ctx, body) {
  if (typeof body.program !== 'string') {
    return {
      ok: false,
      status: 400,
      data: { ok: false, error: 'El campo "program" es obligatorio' },
      error: 'El campo "program" es obligatorio'
    };
  }

  const result = ctx.transmisorService.executeProgram(body.program);
  return { ok: result.ok, status: result.status, data: result, error: null };
}

async function codificar(ctx, body) {
  if (typeof body.program !== 'string' || body.program.trim() === '') {
    return {
      ok: false,
      status: 400,
      data: {
        ok: false,
        valid: false,
        errors: ['El campo "program" es obligatorio'],
        commands: []
      },
      error: null
    };
  }

  const parsed = parseCommands(body.program);

  if (!parsed.valid) {
    return {
      ok: false,
      status: 400,
      data: { ok: false, valid: false, errors: parsed.errors, commands: parsed.commands },
      error: null
    };
  }

  const encoded = ctx.encriptador.codificarPrograma(parsed.commands);

  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      valid: true,
      program: parsed.raw,
      numeroUnico: encoded.numeroUnico,
      bloques: encoded.bloques,
      totalSteps: encoded.bloques.length
    },
    error: null
  };
}

async function programaNumeros(ctx, body) {
  if (typeof body.programa !== 'string' || body.programa.trim() === '') {
    return {
      ok: false,
      status: 400,
      data: {
        ok: false,
        valid: false,
        errors: ['El campo "programa" debe ser un string no vacío'],
        decoded: [],
        bloques: []
      },
      error: null
    };
  }

  const result = ctx.transmisorService.executeEncodedProgram(body.programa.trim());
  return { ok: result.ok, status: result.status, data: result, error: null };
}

async function command(ctx, body) {
  if (!body.command) {
    return {
      ok: false,
      status: 400,
      data: { ok: false, error: 'El campo "command" es obligatorio' },
      error: 'El campo "command" es obligatorio'
    };
  }

  const result = ctx.transmisorService.executeCommand(body.command, body.repetitions);
  return { ok: result.ok, status: result.status, data: result, error: null };
}

async function raw(ctx, body) {
  if (!body.char || typeof body.char !== 'string') {
    return {
      ok: false,
      status: 400,
      data: { ok: false, error: 'El campo "char" es obligatorio' },
      error: 'El campo "char" es obligatorio'
    };
  }

  const result = ctx.transmisorService.sendRawChar(body.char);
  return { ok: result.ok, status: result.status, data: result, error: null };
}

async function classify(ctx, body) {
  const result = ctx.transmisorService.classifyNumber(body.number);
  return { ok: result.ok, status: result.status, data: result, error: null };
}

async function audit(ctx) {
  return {
    ok: true,
    status: 200,
    data: { logs: ctx.auditService.getLogs() },
    error: null
  };
}

async function connectPeer(ctx, body) {
  const { url } = body;

  if (!url) {
    return {
      ok: false,
      status: 400,
      data: { ok: false, error: 'La URL del peer es obligatoria (ej: ws://192.168.0.51:3000/ws/peer)' },
      error: 'La URL del peer es obligatoria'
    };
  }

  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      ok: false,
      status: 400,
      data: { ok: false, error: 'URL inválida. Usá el formato: ws://IP:PUERTO/ws/peer' },
      error: 'URL inválida'
    };
  }

  // Try HTTP health check first
  const httpPort = parsedUrl.port || 3000;
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(`http://${parsedUrl.hostname}:${httpPort}/api/health`, { timeout: 3000 }, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.resume();
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: {
        ok: false,
        error: `No se pudo contactar al peer en ${parsedUrl.hostname}:${httpPort}. Verificá que el backend esté corriendo y la IP sea correcta.`
      },
      error: 'Peer no disponible'
    };
  }

  try {
    const result = await ctx.peerAdapter.connect(url);
    return { ok: true, status: 200, data: result, error: null };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: { ok: false, error: `Error conectando al peer: ${err.message}` },
      error: err.message
    };
  }
}

async function disconnectPeer(ctx) {
  ctx.peerAdapter.disconnect();
  return {
    ok: true,
    status: 200,
    data: { ok: true, status: 'disconnected' },
    error: null
  };
}

async function peerStatus(ctx) {
  return {
    ok: true,
    status: 200,
    data: {
      connected: ctx.peerAdapter.connected,
      role: ctx.peerAdapter.role,
      address: ctx.peerAdapter.address
    },
    error: null
  };
}

async function connectCarPeer(ctx, body) {
  const { ip, port } = body;

  if (!ctx.peerAdapter.connected) {
    return {
      ok: false,
      status: 409,
      data: { ok: false, error: 'No hay conexión con el peer. Conectá el peer primero.' },
      error: 'Peer no conectado'
    };
  }

  try {
    ctx.peerAdapter.sendConnectCar(ip || '192.168.0.50', port || 80);
    return {
      ok: true,
      status: 200,
      data: { ok: true, message: 'Orden de conectar carro enviada al peer' },
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      data: { ok: false, error: err.message },
      error: err.message
    };
  }
}

export const HANDLERS = {
  health,
  rangos,
  connect,
  disconnect,
  'programa-numeros': programaNumeros,
  program,
  codificar,
  command,
  raw,
  classify,
  audit,
  'connect-peer': connectPeer,
  'disconnect-peer': disconnectPeer,
  'peer-status': peerStatus,
  'connect-car-peer': connectCarPeer
};