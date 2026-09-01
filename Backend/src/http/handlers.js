import { parseCommands } from '../core/parser.js';
import { CAMERA_IP, CAMERA_STREAM, DEFAULT_CAR_IP, DEFAULT_CAR_PORT } from '../config/constants.js';
import { tablaService } from '../services/tablaService.js';

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
    data: { rangos: tablaService.getAllCommands() },
    error: null
  };
}

async function connect(ctx, body) {
  // Fase 3: Bloquear conexión manual si el backend actúa como receptor
  if (ctx.peerAdapter.connected && ctx.peerAdapter.role === 'receiver') {
    return {
      ok: false,
      status: 409,
      data: { ok: false, error: 'El receptor no puede conectar el carro manualmente; el transmisor lo controla' },
      error: 'Operación no permitida en modo receptor'
    };
  }

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

  if (ctx.peerAdapter.connected && ctx.peerAdapter.role === 'transmitter') {
    ctx.peerAdapter.sendProgram(body.program);
    return { ok: true, status: 202, data: { message: 'Programa reenviado al receptor' }, error: null };
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

  if (ctx.peerAdapter.connected && ctx.peerAdapter.role === 'transmitter') {
    ctx.peerAdapter.sendProgramaNumeros(body.programa.trim());
    return { ok: true, status: 202, data: { message: 'Programa encriptado reenviado al receptor' }, error: null };
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

  if (ctx.peerAdapter.connected && ctx.peerAdapter.role === 'transmitter') {
    ctx.peerAdapter.sendCommand(body.command, body.repetitions);
    return { ok: true, status: 202, data: { message: 'Comando reenviado al receptor' }, error: null };
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

  if (ctx.peerAdapter.connected && ctx.peerAdapter.role === 'transmitter') {
    ctx.peerAdapter.sendRawChar(body.char);
    return { ok: true, status: 202, data: { message: 'Carácter crudo reenviado al receptor' }, error: null };
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
      data: { ok: false, error: 'La URL del receptor es obligatoria (ej: ws://192.168.0.51/ws)' },
      error: 'La URL del receptor es obligatoria'
    };
  }

  // Validate URL format
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    return {
      ok: false,
      status: 400,
      data: { ok: false, error: 'URL inválida. Usá el formato: ws://IP:PUERTO/ws' },
      error: 'URL inválida'
    };
  }

  // Pure WebSocket connection
  try {
    const result = await ctx.peerAdapter.connect(url);
    return { ok: true, status: 200, data: result, error: null };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: { ok: false, error: `Error conectando al receptor: ${err.message}` },
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
  const carIp = ip || DEFAULT_CAR_IP;
  const carPort = port || DEFAULT_CAR_PORT;

  // Mode 1: External peer connected → POST /robot to the external receptor
  if (ctx.peerAdapter.connected) {
    try {
      await ctx.peerAdapter.sendConnectCar(carIp, carPort);
      return {
        ok: true,
        status: 200,
        data: { ok: true, message: 'Orden de conectar carro enviada al receptor externo', mode: 'peer' },
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

  // Mode 2: No external peer → connect directly (same as 'connect' action)
  try {
    const result = await ctx.carService.connect(carIp, carPort);
    return {
      ok: true,
      status: 200,
      data: { ok: true, message: 'Carro conectado directamente', mode: 'direct', ...result },
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
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