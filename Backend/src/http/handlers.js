import os from 'os';
import { parseCommands } from '../core/parser.js';
import { CAMERA_IP, CAMERA_STREAM, DEFAULT_CAR_IP, DEFAULT_CAR_PORT } from '../config/constants.js';
import { tablaService } from '../services/tablaService.js';
import { scanNetwork, pickRandom, getOwnIPs } from '../services/networkScanner.js';

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
  // R3: bloqueado mientras el dispositivo esté actuando como receptor
  if (ctx.wsServerAdapter?._pruneDeadPeers) {
    ctx.wsServerAdapter._pruneDeadPeers();
  }
  const inbound = ctx.wsServerAdapter?.peerConnections?.size || 0;
  if (inbound >= 1) {
    return {
      ok: false,
      status: 409,
      data: { ok: false, error: 'Estás como receptor: desconectá al transmisor entrante antes de conectarte a otro receptor.' },
      error: 'receptor-locked'
    };
  }

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
    // Si falló el connect, asegurarse de que peerAdapter quede desconectado
    try { ctx.peerAdapter.disconnect(); } catch {}
    // El receptor rechaza en el upgrade con 503 cuando ya está ocupado.
    const occupied = /503/.test(err.message);
    return {
      ok: false,
      status: occupied ? 503 : 502,
      data: {
        ok: false,
        error: occupied
          ? 'El receptor está ocupado (ya tiene un transmisor conectado o está transmitiendo). Probá con otro dispositivo.'
          : `Error conectando al receptor: ${err.message}`
      },
      error: occupied ? 'receptor-ocupado' : err.message
    };
  }
}

async function disconnectPeer(ctx) {
  ctx.peerAdapter.disconnect();
  if (ctx.wsServerAdapter?.disconnectPeers) {
    ctx.wsServerAdapter.disconnectPeers();
  }
  return {
    ok: true,
    status: 200,
    data: { ok: true, status: 'disconnected' },
    error: null
  };
}

async function peerStatus(ctx) {
  if (ctx.wsServerAdapter?._pruneDeadPeers) {
    ctx.wsServerAdapter._pruneDeadPeers();
  }
  const inboundCount = ctx.wsServerAdapter?.peerConnections?.size || 0;
  return {
    ok: true,
    status: 200,
    data: {
      connected: ctx.peerAdapter.connected,
      role: ctx.peerAdapter.connected ? ctx.peerAdapter.role : (inboundCount > 0 ? 'receiver' : null),
      address: ctx.peerAdapter.address,
      inboundPeers: inboundCount
    },
    error: null
  };
}

async function connectCarPeer(ctx, body) {
  const { ip, port, path } = body;
  const carIp = ip || DEFAULT_CAR_IP;
  const carPort = port || DEFAULT_CAR_PORT;
  const carPath = path || '/ws';

  // Mode 1: External peer connected → POST /robot to the external receptor
  if (ctx.peerAdapter.connected) {
    try {
      const res = await ctx.peerAdapter.sendConnectCar(carIp, carPort, carPath);
      const carOk = res ? Boolean(res.ok) : true;
      return {
        ok: carOk,
        status: carOk ? 200 : 502,
        data: {
          ok: carOk,
          message: carOk
            ? 'Carro conectado en el receptor externo'
            : 'El receptor externo no pudo conectar al carro físico (apagado o fuera de red)',
          mode: 'peer'
        },
        error: carOk ? null : 'Carro no disponible'
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

async function scanAndConnect(ctx, body) {
  // R3: bloqueado mientras el dispositivo esté actuando como receptor
  if (ctx.wsServerAdapter?._pruneDeadPeers) {
    ctx.wsServerAdapter._pruneDeadPeers();
  }
  const inbound = ctx.wsServerAdapter?.peerConnections?.size || 0;
  if (inbound >= 1) {
    return {
      ok: false,
      status: 409,
      data: { ok: false, error: 'Estás como receptor: desconectá al transmisor entrante antes de conectarte a otro receptor.' },
      error: 'receptor-locked'
    };
  }

  const port = body.port || 80;
  const baseIP = body.baseIP;
  const startOctet = body.startOctet;
  const endOctet = body.endOctet;

  try {
    // 1. Escanear la red
    const scanOpts = { port };
    if (baseIP !== undefined) scanOpts.baseIP = baseIP;
    if (startOctet !== undefined) scanOpts.startOctet = startOctet;
    if (endOctet !== undefined) scanOpts.endOctet = endOctet;
    // Excluir la IP del carro del escaneo
    scanOpts.excludeIP = ctx.carService.address ? ctx.carService.address.split(':')[0] : undefined;
    const { available, scanned } = await scanNetwork(scanOpts);

    if (available.length === 0) {
      return {
        ok: false,
        status: 200,
        data: {
          ok: false,
          scanned,
          available,
          message: 'No se encontraron receptores en la red'
        },
        error: null
      };
    }

    // 2. Conectar al receptor (iterando candidatos al azar para evitar race conditions si uno está ocupado o se cae)
    const candidates = [...available].sort(() => Math.random() - 0.5);
    let chosen = null;
    let receptorURL = null;
    let lastConnectError = null;

    for (const candidate of candidates) {
      const targetURL = `ws://${candidate.ip}:${port}${candidate.path}`;
      if (ctx.peerAdapter.connected) {
        ctx.peerAdapter.disconnect();
      }
      try {
        await ctx.peerAdapter.connect(targetURL, 'transmitter');
        chosen = candidate;
        receptorURL = targetURL;
        break;
      } catch (err) {
        lastConnectError = err;
        try { ctx.peerAdapter.disconnect(); } catch {}
      }
    }

    if (!chosen) {
      throw lastConnectError || new Error('No se pudo conectar a ningún receptor disponible');
    }

    // 3. CONEXIÓN AUTOMÁTICA CARRO + CÁMARA (usando constantes configuradas)
    const CAR_IP = DEFAULT_CAR_IP || '192.168.0.50';
    const CAR_PORT = DEFAULT_CAR_PORT || 80;
    let carConnected = false;

    try {
      const carUrl = `ws://${CAR_IP}:${CAR_PORT}/ws`;
      if (typeof ctx.peerAdapter.sendConnectCar === 'function') {
        const carRes = await ctx.peerAdapter.sendConnectCar(CAR_IP, CAR_PORT, '/ws');
        carConnected = carRes ? Boolean(carRes.ok) : true;
      }
      if (carConnected) {
        console.log(`✅ Carro y cámara conectados automáticamente: ${carUrl}`);
      } else {
        console.warn(`⚠️ Receptor conectado (${chosen.ip}), pero el carro (${carUrl}) está apagado o fuera de línea`);
      }
    } catch (carErr) {
      console.warn('⚠️ Error conectando carro/cámara automáticamente:', carErr.message);
      // No fallar la conexión al receptor si el carro físico está apagado
    }

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        scanned,
        available,
        connectedTo: chosen.ip,
        receptorURL,
        carConnected,
        message: carConnected
          ? `Conectado a receptor en ${chosen.ip} (${chosen.path}) - Carro y cámara conectados automáticamente`
          : `Conectado a receptor en ${chosen.ip} (${chosen.path}) - Carro físico apagado o desconectado`
      },
      error: null
    };
  } catch (err) {
    const occupied = /503/.test(err.message);
    return {
      ok: false,
      status: occupied ? 503 : 500,
      data: {
        ok: false,
        error: occupied
          ? 'El receptor elegido está ocupado. Volvé a intentar (se elegirá otro al azar).'
          : err.message,
        message: occupied ? 'Receptor ocupado' : 'Error durante el escaneo'
      },
      error: occupied ? 'receptor-ocupado' : err.message
    };
  }
}

async function scanNetworkHandler(ctx, body) {
  const port = body.port || 80;
  const baseIP = body.baseIP || undefined;
  const startOctet = body.startOctet;
  const endOctet = body.endOctet;
  try {
    const scanOpts = { port, baseIP };
    if (startOctet !== undefined) scanOpts.startOctet = startOctet;
    if (endOctet !== undefined) scanOpts.endOctet = endOctet;
    // Excluir la IP del carro del escaneo
    scanOpts.excludeIP = ctx.carService.address ? ctx.carService.address.split(':')[0] : undefined;
    const { available, scanned, baseIP: resolvedBase, segments } = await scanNetwork(scanOpts);
    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        available,
        scanned,
        baseIP: resolvedBase,
        segments,
        myIPs: getOwnIPs(),
        hostname: os.hostname()
      },
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      data: { ok: false, error: err.message, available: [], scanned: [] },
      error: err.message
    };
  }
}

async function misDirecciones(ctx) {
  const port = process.env.PORT || 3000;
  const ifaces = os.networkInterfaces();
  const direcciones = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        direcciones.push({
          ip: iface.address,
          interface: name,
          wsTransmisor: `ws://${iface.address}:${port}/transmisor`,
          wsPeer: `ws://${iface.address}:${port}/ws/peer`,
          wsApi: `ws://${iface.address}:${port}/ws/api`
        });
      }
    }
  }
  return {
    ok: true,
    status: 200,
    data: {
      nombre: os.hostname(),
      misDirecciones: direcciones.length > 0
        ? direcciones
        : [{ ip: '127.0.0.1', interface: 'loopback', wsTransmisor: `ws://127.0.0.1:${port}/transmisor`, wsPeer: `ws://127.0.0.1:${port}/ws/peer`, wsApi: `ws://127.0.0.1:${port}/ws/api` }]
    },
    error: null
  };
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
  'connect-car-peer': connectCarPeer,
  'scan-and-connect': scanAndConnect,
  'scan-network': scanNetworkHandler,
  'mis-direcciones': misDirecciones
};