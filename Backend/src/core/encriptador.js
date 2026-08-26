import { getClassificationResults, countDivisibilities } from './automatas.js';
import { tablaService } from '../services/tablaService.js';
import logger from '../utils/logger.js';

export function getRangeByCommand(command) {
  return tablaService.getCommandMeta(command) || null;
}

export function getCommandByRange(number) {
  return tablaService.getCommandByRange(number);
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
  
  const PRIMES = tablaService.getPrimes();

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
    // 'command' in the tablaService is actually the key, but it's 'esp32' inside. 
    // We can use esp32 which equals the command letter.
    command = rangeEntry.esp32;
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

    const { numero, intentos } = generarNumeroConIntentos(cmd.command);

    if (numero == null) {
      continue;
    }

    const bloqueCompleto = `${numero}${repetitions}`;

    bloques.push({
      numero,
      repeticiones: repetitions,
      bloqueCompleto,
      command: cmd.command,
      name: cmd.name || getRangeByCommand(cmd.command)?.name || null,
      intentos
    });
  }

  const numeroUnico = bloques.map((b) => b.bloqueCompleto).join('');

  return { numeroUnico, bloques };
}

export function decodificarPrograma(numeroStr) {
  const errors = [];
  const raw = typeof numeroStr === 'string' ? numeroStr.trim() : '';

  if (!raw) {
    return { valid: false, errors: ['El programa numérico está vacío'], decoded: [], bloques: [] };
  }

  if (raw.length % 5 !== 0) {
    return {
      valid: false,
      errors: [`La longitud del programa numérico debe ser múltiplo de 5 (recibido ${raw.length} dígitos)`],
      decoded: [],
      bloques: []
    };
  }

  const bloques = [];
  const decoded = [];

  for (let i = 0; i < raw.length; i += 5) {
    const numStr = raw.slice(i, i + 4);
    const repStr = raw.slice(i + 4, i + 5);
    const numero = Number(numStr);
    const repeticiones = Number(repStr);
    const blockIndex = i / 5 + 1;

    if (!Number.isInteger(numero) || numero < 1000 || numero > 9999 || repeticiones < 1 || repeticiones > 9) {
      errors.push(`Bloque ${blockIndex}: '${numStr}${repStr}' es inválido (N° de 4 dígitos + 1 dígito de repetición)`);
      bloques.push({ bloqueCompleto: `${numStr}${repStr}`, classification: 'INVALIDO', classifiedAs: 'INVALIDO', command: null, name: null });
      continue;
    }

    const classification = clasificarNumero(numero);

    if (classification.classifiedAs !== 'VALIDO') {
      errors.push(`Bloque ${blockIndex}: N°${numero} rechazado (${classification.classifiedAs}): ${classification.details}`);
      bloques.push({ bloqueCompleto: `${numStr}${repStr}`, numero, repeticiones, ...classification });
      continue;
    }

    bloques.push({ bloqueCompleto: `${numStr}${repStr}`, numero, repeticiones, ...classification });
    decoded.push({
      command: classification.command,
      repetitions: repeticiones,
      numero,
      token: `${classification.command}${repeticiones > 1 ? ':' + repeticiones : ''}`,
      esp32Char: classification.command,
      name: classification.name,
      type: null
    });
  }

  return { valid: errors.length === 0, errors, decoded, bloques };
}
