import { getClassificationResults, countDivisibilities, PRIMES } from './automatas.js';

export const NUMBER_TABLE = {
  A: { numbers: [1025, 1032, 1034, 1060, 1062, 1037], name: 'Avanzar' },
  R: { numbers: [1066, 1075, 1081, 1007, 1003, 1098], name: 'Retroceder' },
  D: { numbers: [1107, 1118, 1128, 1113, 1121, 1159], name: 'Girar Derecha' },
  I: { numbers: [1148, 1161, 1175, 1166, 1180, 1220], name: 'Girar Izquierda' },
  O: { numbers: [1189, 1204, 1222, 1219, 1239, 1281], name: 'Abrir Pinza' },
  F: { numbers: [1230, 1247, 1269, 1272, 1298, 1342], name: 'Apagar Cámara' },
  P: { numbers: [1271, 1290, 1316, 1325, 1357, 1403], name: 'Encender Cámara' },
  C: { numbers: [1312, 1333, 1363, 1378, 1416, 1464], name: 'Cerrar Pinza' },
  M: { numbers: [1353, 1376, 1410, 1431, 1475, 1525], name: 'Liberar Control' }
};

export const ALL_NUMBERS = [];
for (const [cmd, data] of Object.entries(NUMBER_TABLE)) {
  for (const num of data.numbers) {
    ALL_NUMBERS.push({ number: num, command: cmd, name: data.name });
  }
}

export function selectRandomNumber(command) {
  const data = NUMBER_TABLE[command];
  if (!data) return null;
  const idx = Math.floor(Math.random() * data.numbers.length);
  return data.numbers[idx];
}

export function getCommandByNumber(number) {
  for (const [cmd, data] of Object.entries(NUMBER_TABLE)) {
    if (data.numbers.includes(number)) {
      return { command: cmd, name: data.name };
    }
  }
  return null;
}

export function classifyNumber(number) {
  const inTable = getCommandByNumber(number);
  const results = getClassificationResults(number);
  const divisibleCount = countDivisibilities(results);

  let classifiedAs;
  let command = null;
  let details = '';

  if (divisibleCount >= 2) {
    classifiedAs = 'CORRUPTO';
    const divisors = PRIMES.filter(p => results[p]);
    details = `Divisible por ${divisibleCount} primos: [${divisors.join(', ')}]`;
  } else if (inTable && divisibleCount === 1) {
    classifiedAs = 'VALIDO';
    command = inTable.command;
    const divisiblePrime = PRIMES.find(p => results[p]);
    details = `Divisible por ${divisiblePrime} → ${inTable.name}`;
  } else if (!inTable) {
    classifiedAs = 'FALSO';
    details = `Número ${number} no pertenece a la tabla autorizada`;
  } else {
    classifiedAs = 'FALSO';
    details = `Número ${number} en tabla pero no divisible por ningún primo`;
  }

  return {
    number,
    results,
    classifiedAs,
    command,
    details,
    divisibleCount,
    inTable: !!inTable
  };
}
