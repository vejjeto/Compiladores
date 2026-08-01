const COMMAND_MAP = {
  A: { esp32: 'F', name: 'Avanzar', type: 'movement' },
  R: { esp32: 'B', name: 'Retroceder', type: 'movement' },
  D: { esp32: 'R', name: 'Girar Derecha', type: 'movement' },
  I: { esp32: 'L', name: 'Girar Izquierda', type: 'movement' },
  O: { esp32: 'O', name: 'Abrir Pinza', type: 'action' },
  C: { esp32: 'C', name: 'Cerrar Pinza', type: 'action' },
  P: { esp32: 'N', name: 'Encender Cámara', type: 'camera' },
  F: { esp32: 'P', name: 'Apagar Cámara', type: 'camera' },
  M: { esp32: 'M', name: 'Liberar Control', type: 'action' }
};

const MOVEMENT_COMMANDS = ['A', 'R', 'D', 'I'];
const ACTION_COMMANDS = ['P', 'F', 'O', 'C', 'M'];
const COMMAND_REGEX = /^([A-Z])(?::([1-9]))?$/;

export function parseCommands(inputString) {
  const errors = [];
  const raw = (inputString || '').trim();

  if (!raw) {
    return { valid: false, errors: ['El programa está vacío'], commands: [], raw };
  }

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

    if (!COMMAND_MAP[cmd]) {
      errors.push(`Comando desconocido '${cmd}' en posición ${i + 1}`);
      continue;
    }

    const repetitions = repStr ? parseInt(repStr, 10) : 1;
    const mapping = COMMAND_MAP[cmd];

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

  const pIndex = commands.findIndex(c => c.command === 'P');
  const fIndex = commands.map(c => c.command).lastIndexOf('F');

  if (pIndex !== -1 && pIndex !== 0) {
    errors.push(`Error semántico: 'P' debe ser el primer comando (posición actual: ${pIndex + 1})`);
  }

  if (fIndex !== -1 && fIndex !== commands.length - 1) {
    errors.push(`Error semántico: 'F' debe ser el último comando (posición actual: ${fIndex + 1})`);
  }

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];

    if (!COMMAND_MAP[cmd.command]) {
      errors.push(`Comando desconocido '${cmd.command}' en posición ${i + 1}`);
    } else if (ACTION_COMMANDS.includes(cmd.command) && cmd.repetitions > 1) {
      errors.push(`Error semántico: '${cmd.command}' no acepta parámetro de repetición (encontrado '${cmd.token || cmd.command}')`);
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
  return COMMAND_MAP[command] || null;
}

export { COMMAND_MAP, MOVEMENT_COMMANDS, ACTION_COMMANDS };
