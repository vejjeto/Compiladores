import { parseCommands } from '../core/parser.js';

async function health(ctx) {
  return {
    ok: true,
    status: 200,
    data: {
      status: 'ok',
      carConnected: ctx.carService.connected,
      carAddress: ctx.carService.address
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
  audit
};