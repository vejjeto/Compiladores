import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  COMMAND_RANGE,
  getCommandByRange,
  generarNumero,
  clasificarNumero,
  classifyNumber,
  codificarPrograma,
  decodificarPrograma
} from '../src/core/encriptador.js';

describe('Encriptador - COMMAND_RANGE', () => {

  it('debe tener los 9 comandos con sus rangos y nombres', () => {
    assert.strictEqual(Object.keys(COMMAND_RANGE).length, 9);
    const expected = {
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
    assert.deepStrictEqual(COMMAND_RANGE, expected);
  });

  it('los rangos cubren de 1000 a 9999 sin solaparse', () => {
    const entries = Object.entries(COMMAND_RANGE).sort((a, b) => a[1].min - b[1].min);
    assert.strictEqual(entries[0][1].min, 1000);
    assert.strictEqual(entries[entries.length - 1][1].max, 9999);
    for (let i = 0; i < entries.length; i++) {
      assert.strictEqual(entries[i][1].max - entries[i][1].min, 999);
      if (i > 0) {
        assert.strictEqual(entries[i][1].min, entries[i - 1][1].max + 1);
      }
    }
  });

  it('getCommandByRange identifica el comando por el rango', () => {
    assert.strictEqual(getCommandByRange(1025).command, 'F');
    assert.strictEqual(getCommandByRange(2999).command, 'B');
    assert.strictEqual(getCommandByRange(5000).command, 'O');
    assert.strictEqual(getCommandByRange(9999).command, 'M');
    assert.strictEqual(getCommandByRange(1), null);
    assert.strictEqual(getCommandByRange(10000), null);
  });

});

describe('Encriptador - generarNumero', () => {

  it('debe generar un número dentro del rango del comando, divisible por exactamente 1 primo', () => {
    for (const command of Object.keys(COMMAND_RANGE)) {
      const num = generarNumero(command);
      const range = COMMAND_RANGE[command];
      assert.ok(num >= range.min && num <= range.max, `N°${num} debe estar en el rango de ${command}`);
      const classification = clasificarNumero(num);
      assert.strictEqual(classification.classifiedAs, 'VALIDO', `N°${num} debe ser VALIDO`);
      assert.strictEqual(classification.command, command, `N°${num} debe pertenecer a ${command}`);
    }
  });

  it('generarNumero con comando desconocido devuelve null', () => {
    assert.strictEqual(generarNumero('X'), null);
  });

});

describe('Encriptador - clasificarNumero / classifyNumber', () => {

  it('clasifica como VALIDO un número generado en rango', () => {
    for (let i = 0; i < 50; i++) {
      const num = generarNumero('F');
      const result = clasificarNumero(num);
      assert.strictEqual(result.classifiedAs, 'VALIDO');
      assert.strictEqual(result.command, 'F');
      assert.strictEqual(result.name, 'Avanzar');
      assert.strictEqual(result.divisibleCount, 1);
      assert.strictEqual(result.inRange, true);
    }
  });

  it('classifyNumber es un alias de clasificarNumero', () => {
    const num = generarNumero('R');
    assert.deepStrictEqual(classifyNumber(num), clasificarNumero(num));
  });

  it('un número fuera de rango y no divisible debe ser FALSO', () => {
    const result = clasificarNumero(100);
    assert.strictEqual(result.classifiedAs, 'FALSO');
    assert.strictEqual(result.inRange, false);
    assert.strictEqual(result.command, null);
  });

  it('un número en rango pero no divisible por ningún primo debe ser FALSO', () => {
    const result = clasificarNumero(1001);
    assert.strictEqual(result.classifiedAs, 'FALSO');
    assert.strictEqual(result.inRange, true);
    assert.strictEqual(result.divisibleCount, 0);
  });

  it('un número fuera de rango divisible por un primo debe ser FALSO', () => {
    const result = clasificarNumero(41);
    assert.strictEqual(result.classifiedAs, 'FALSO');
    assert.strictEqual(result.divisibleCount, 1);
  });

  it('un número divisible por varios primos debe ser CORRUPTO', () => {
    const result = clasificarNumero(1763);
    assert.strictEqual(result.classifiedAs, 'CORRUPTO');
    assert.strictEqual(result.divisibleCount, 2);
    assert.strictEqual(result.inRange, true);
  });

});

describe('Encriptador - codificarPrograma / decodificarPrograma', () => {

  it('codificarPrograma concatena un número por repetición (F:3, R → 4 bloques, 16 dígitos)', () => {
    const result = codificarPrograma([
      { command: 'F', repetitions: 3 },
      { command: 'R', repetitions: 1 }
    ]);
    assert.strictEqual(result.bloques.length, 4);
    assert.strictEqual(result.numeroUnico.length, 16);
    assert.deepStrictEqual(result.bloques.map(b => b.command), ['F', 'F', 'F', 'R']);
    assert.ok(result.numeroUnico.split('').every(c => c >= '0' && c <= '9'));
  });

  it('decodificarPrograma corta el string en bloques de 4 dígitos y clasifica', () => {
    const encoded = codificarPrograma([
      { command: 'F', repetitions: 3 },
      { command: 'R', repetitions: 1 }
    ]);
    const result = decodificarPrograma(encoded.numeroUnico);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.deepStrictEqual(result.decoded.map(d => d.command), ['F', 'F', 'F', 'R']);
    assert.strictEqual(result.bloques.length, 4);
    for (const block of result.bloques) {
      assert.strictEqual(block.classifiedAs, 'VALIDO');
    }
  });

  it('round-trip: codificar → decodificar preserva los comandos', () => {
    const original = [
      { command: 'N', repetitions: 1 },
      { command: 'F', repetitions: 2 },
      { command: 'B', repetitions: 1 },
      { command: 'O', repetitions: 1 },
      { command: 'C', repetitions: 1 },
      { command: 'P', repetitions: 1 }
    ];
    const encoded = codificarPrograma(original);
    const result = decodificarPrograma(encoded.numeroUnico);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.decoded.map(d => d.command), ['N', 'F', 'F', 'B', 'O', 'C', 'P']);
    assert.ok(result.decoded.every(d => d.repetitions === 1));
    assert.strictEqual(encoded.numeroUnico.length, 7 * 4);
  });

  it('decodificarPrograma con string vacío es inválido', () => {
    const result = decodificarPrograma('');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('vacío')));
  });

  it('decodificarPrograma con longitud no múltiplo de 4 es inválido', () => {
    const result = decodificarPrograma('10251');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('múltiplo de 4')));
  });

  it('decodificarPrograma rechaza bloque fuera del rango de 4 dígitos', () => {
    const result = decodificarPrograma('00411025');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('4 dígitos')));
  });

  it('decodificarPrograma rechaza bloque en rango no divisible (FALSO)', () => {
    const result = decodificarPrograma('10001025');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('FALSO')));
    assert.deepStrictEqual(result.decoded.map(d => d.command), ['F']);
  });

  it('decodificarPrograma rechaza bloque corrupto (CORRUPTO)', () => {
    const result = decodificarPrograma('1763');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('CORRUPTO')));
  });

});
