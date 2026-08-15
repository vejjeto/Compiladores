import { getClassificationResults, countDivisibilities, PRIMES } from './automatas.js';
import logger from '../utils/logger.js';

export const COMMAND_RANGE = {
  F: { min: 1000, max: 1999, name: 'Avanzar' },
  B: { min: 2000, max: 2999, name: 'Retroceder' },
  R: { min: 3000, max: 3999, name: 'Girar Derecha' },
  L: { min: 4000, max: 4999, name: 'Girar Izquierda' },
  O: { min: 5000, max: 5999, name: 'Abrir Pinza' },
  C: { min: 6000, max: 6999, name: 'Cerrar Pinza' },
  N: { min: 7000, max: 7999, name: 'Encender Cámara' },
  P: { min: 8000, max: 8999, name: 'Apagar Cámara' },
  M: { min: 9000, max: 9999, name: 'Liberar Control' }
};

export function getRangeByCommand(command) {
  return COMMAND_RANGE[command] || null;
}

export function getCommandByRange(number) {
  for (const [command, range] of Object.entries(COMMAND_RANGE)) {
    if (number >= range.min && number <= range.max) {
      return { command, ...range };
    }
  }
  return null;
}

export function generarNumeroConIntentos(command) {
  const range = getRangeByCommand(command);

  if (!range) {
    logger.debug('Encriptador', `Command '${command}' has no authorized range.`);
    return { numero: null, intentos: [] };
  }

  const intentos = [];

  for (let attempt = 0; attempt < 10000; attempt++) {
    const candidate = range.min + Math.floor(Math.random() * (range.max - range.min + 1));
    const divisibleCount = countDivisibilities(getClassificationResults(candidate));

    if (divisibleCount === 1) {
      logger.debug('Encriptador', `Number ${candidate} generated for command ${command}.`);
      return { numero: candidate, intentos };
    }

    intentos.push(candidate);
  }

  return { numero: null, intentos };
}

export function generarNumero(command) {
  return generarNumeroConIntentos(command).numero;
}

export function clasificarNumero(number) {
  const results = getClassificationResults(number);
  const divisibleCount = countDivisibilities(results);
  const rangeEntry = getCommandByRange(number);

  let classifiedAs;
  let command = null;
  let name = null;
  let details = '';

  if (divisibleCount >= 2) {
    classifiedAs = 'CORRUPTO';
    const divisors = PRIMES.filter((p) => results[p]);
    details = `Divisible por ${divisibleCount} primos: [${divisors.join(', ')}]`;
    logger.error('Encriptador', `Number ${number} classified as CORRUPTO. ${details}`);
  } else if (rangeEntry && divisibleCount === 1) {
    classifiedAs = 'VALIDO';
    command = rangeEntry.command;
    name = rangeEntry.name;
    const divisiblePrime = PRIMES.find((p) => results[p]);
    details = `Divisible por ${divisiblePrime} → ${name}`;
  } else if (!rangeEntry) {
    classifiedAs = 'FALSO';
    details = `Número ${number} no pertenece a ningún rango autorizado`;
  } else {
    classifiedAs = 'FALSO';
    details = `Número ${number} en rango pero no divisible por ningún primo`;
  }

  return {
    number,
    results,
    classifiedAs,
    command,
    name,
    details,
    divisibleCount,
    inRange: !!rangeEntry
  };
}

export const classifyNumber = clasificarNumero;

export function codificarPrograma(comandos) {
  const bloques = [];

  for (const cmd of comandos) {
    const repetitions = Math.max(1, cmd.repetitions || 1);

    for (let i = 0; i < repetitions; i++) {
      const { numero, intentos } = generarNumeroConIntentos(cmd.command);

      if (numero == null) {
        continue;
      }

      bloques.push({
        numero,
        command: cmd.command,
        name: cmd.name || getRangeByCommand(cmd.command)?.name || null,
        intentos
      });
    }
  }

  const numeroUnico = bloques.map((b) => String(b.numero)).join('');

  return { numeroUnico, bloques };
}

export function decodificarPrograma(numeroStr) {
  const errors = [];
  const raw = typeof numeroStr === 'string' ? numeroStr.trim() : '';

  if (!raw) {
    return { valid: false, errors: ['El programa numérico está vacío'], decoded: [], bloques: [] };
  }

  if (raw.length % 4 !== 0) {
    return {
      valid: false,
      errors: [`La longitud del programa numérico debe ser múltiplo de 4 (recibido ${raw.length} dígitos)`],
      decoded: [],
      bloques: []
    };
  }

  const bloques = [];
  const decoded = [];

  for (let i = 0; i < raw.length; i += 4) {
    const blockStr = raw.slice(i, i + 4);
    const numero = Number(blockStr);
    const blockIndex = i / 4 + 1;

    if (!Number.isInteger(numero) || numero < 1000 || numero > 9999) {
      errors.push(`Bloque ${blockIndex}: '${blockStr}' no es un número de 4 dígitos entre 1000 y 9999`);
      bloques.push({ numero: blockStr, classification: 'INVALIDO', classifiedAs: 'INVALIDO', command: null, name: null });
      continue;
    }

    const classification = clasificarNumero(numero);

    if (classification.classifiedAs !== 'VALIDO') {
      errors.push(`Bloque ${blockIndex}: N°${numero} rechazado (${classification.classifiedAs}): ${classification.details}`);
      bloques.push({ numero, ...classification });
      continue;
    }

    bloques.push({ numero, ...classification });
    decoded.push({
      command: classification.command,
      repetitions: 1,
      numero,
      token: classification.command,
      esp32Char: classification.command,
      name: classification.name,
      type: null
    });
  }

  return { valid: errors.length === 0, errors, decoded, bloques };
}
