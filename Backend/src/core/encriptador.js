import { divisibilityAutomaton, getClassificationResults, countDivisibilities } from './automatas.js';

export const NUMBER_TABLE = {
  A: { numbers: [1024, 1032, 1040, 1048, 1056, 1064], prime: 2, name: 'Avanzar' },
  R: { numbers: [1002, 1005, 1008, 1011, 1014, 1098], prime: 3, name: 'Retroceder' },
  D: { numbers: [1100, 1105, 1110, 1115, 1120, 1125], prime: 5, name: 'Girar Derecha' },
  I: { numbers: [1141, 1148, 1155, 1162, 1169, 1176], prime: 7, name: 'Girar Izquierda' },
  O: { numbers: [1199, 1210, 1221, 1232, 1243, 1254], prime: 11, name: 'Abrir Pinza' },
  F: { numbers: [1235, 1248, 1261, 1274, 1287, 1300], prime: 13, name: 'Apagar Cámara' },
  P: { numbers: [1275, 1292, 1309, 1326, 1343, 1360], prime: 17, name: 'Encender Cámara' },
  C: { numbers: [1311, 1330, 1349, 1368, 1387, 1406], prime: 19, name: 'Cerrar Pinza' }
};

const ALL_NUMBERS = [];
for (const [cmd, data] of Object.entries(NUMBER_TABLE)) {
  for (const num of data.numbers) {
    ALL_NUMBERS.push({ number: num, command: cmd, ...data });
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
      return { command: cmd, prime: data.prime, name: data.name };
    }
  }
  return null;
}

export function getPrimeForCommand(command) {
  const data = NUMBER_TABLE[command];
  return data ? data.prime : null;
}

export function classifyNumber(number) {
  const inTable = getCommandByNumber(number);
  const results = getClassificationResults(number);
  const divisibleCount = countDivisibilities(results);

  let classifiedAs;
  let command = null;
  let details = '';
  let prime = null;

  if (!inTable) {
    classifiedAs = 'FALSO';
    details = `Número ${number} no pertenece a la tabla autorizada`;
  } else if (divisibleCount === 1) {
    classifiedAs = 'VALIDO';
    command = inTable.command;
    prime = inTable.prime;
    details = `Divisible por ${inTable.prime} → ${inTable.name}`;
  } else if (divisibleCount === 0) {
    classifiedAs = 'FALSO';
    details = `Número ${number} en tabla pero no divisible por ningún primo`;
  } else {
    classifiedAs = 'CORRUPTO';
    const divisors = Object.entries(results)
      .filter(([_, v]) => v)
      .map(([k]) => k);
    details = `Divisible por ${divisibleCount} primos: [${divisors.join(', ')}]`;
  }

  return {
    number,
    results,
    classifiedAs,
    command,
    prime,
    details,
    divisibleCount,
    inTable: !!inTable
  };
}
