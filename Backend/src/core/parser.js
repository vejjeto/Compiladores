import { tablaService } from '../services/tablaService.js';

const COMMAND_REGEX = /^([A-Z])(?::([1-9]))?$/;

export function parseCommands(inputString) {
  const errors = [];
  let raw = (inputString || '').trim();

  if (!raw) {
    return { valid: false, errors: ['El programa está vacío'], commands: [], raw };
  }

  // Normalizar separadores: aceptar coma, punto y coma, o espacios
  raw = raw.replace(/;/g, ',').replace(/\s+/g, ',');

  // Limpiar comas múltiples
  raw = raw.replace(/,+/g, ',').replace(/^,|,$/g, '');

  const tokens = raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
  const commands = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const match = token.match(COMMAND_REGEX);

    if (!match) {
      errors.push(`Token inválido '${token}' en posición ${i + 1}`);
      continue;
    }

    const [, cmd, repStr] = match;
    const mapping = tablaService.getCommandMeta(cmd);

    if (!mapping) {
      errors.push(`Comando desconocido '${cmd}' en posición ${i + 1}`);
      continue;
    }

    const repetitions = repStr ? parseInt(repStr, 10) : 1;

    commands.push({
      command: cmd,
      repetitions,
      token,
      esp32Char: mapping.esp32,
      name: mapping.name,
      type: mapping.type
    });
  }

  errors.push(...validateCommands(commands));

  return {
    valid: errors.length === 0,
    errors,
    commands,
    raw,
    esp32Sequence: buildESP32Sequence(commands)
  };
}

export function validateCommands(commands) {
  const errors = [];

  const nIndex = commands.findIndex(c => c.command === 'N');
  const pIndex = commands.map(c => c.command).lastIndexOf('P');

  if (nIndex !== -1 && nIndex !== 0) {
    errors.push(`Error semántico: 'N' debe ser el primer comando (posición actual: ${nIndex + 1})`);
  }

  if (pIndex !== -1 && pIndex !== commands.length - 1) {
    errors.push(`Error semántico: 'P' debe ser el último comando (posición actual: ${pIndex + 1})`);
  }

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const mapping = tablaService.getCommandMeta(cmd.command);

    if (!mapping) {
      errors.push(`Comando desconocido '${cmd.command}' en posición ${i + 1}`);
    } else if (mapping.type === 'action' || mapping.type === 'camera') {
      if (cmd.repetitions > 1) {
         errors.push(`Error semántico: '${cmd.command}' no acepta parámetro de repetición (encontrado '${cmd.token || cmd.command}')`);
      }
    }
  }

  return errors;
}

export function buildESP32Sequence(commands) {
  const sequence = [];

  for (const cmd of commands) {
    for (let i = 0; i < cmd.repetitions; i++) {
      sequence.push({
        char: cmd.esp32Char,
        command: cmd.command,
        name: cmd.name,
        step: i + 1,
        total: cmd.repetitions,
        ...(cmd.numero != null ? { numero: cmd.numero } : {})
      });
    }
  }

  return sequence;
}

export function getCommandInfo(command) {
  return tablaService.getCommandMeta(command);
}
