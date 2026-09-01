import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getCommandByRange,
  generarNumero,
  clasificarNumero,
  classifyNumber,
  codificarPrograma,
  decodificarPrograma
} from '../src/core/encriptador.js';
import { tablaService } from '../src/services/tablaService.js';

tablaService.loadTableSync();

describe('Encriptador - COMMAND_RANGE', () => {
  it('debe tener los 9 comandos con sus rangos y nombres', () => {
    const commands = tablaService.getAllCommands();
    assert.strictEqual(Object.keys(commands).length, 9);
  });

  it('los rangos cubren de 1000 a 9999 sin solaparse', () => {
    const commands = tablaService.getAllCommands();
    const entries = Object.entries(commands).sort((a, b) => a[1].min - b[1].min);
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
    assert.strictEqual(getCommandByRange(1025).esp32, 'F');
    assert.strictEqual(getCommandByRange(2999).esp32, 'B');
    assert.strictEqual(getCommandByRange(5000).esp32, 'N');
    assert.strictEqual(getCommandByRange(7000).esp32, 'O');
    assert.strictEqual(getCommandByRange(9999).esp32, 'M');
    assert.strictEqual(getCommandByRange(1), null);
    assert.strictEqual(getCommandByRange(10000), null);
  });

});

describe('Encriptador - generarNumero', () => {

  it('debe generar un número dentro del rango del comando, divisible por exactamente 1 primo', () => {
    const commands = tablaService.getAllCommands();
    for (const command of Object.keys(commands)) {
      const num = generarNumero(command);
      const range = commands[command];
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

  it('codificarPrograma genera 5 dígitos (F:3, R → 2 bloques, 10 dígitos)', () => {
    const result = codificarPrograma([
      { command: 'F', repetitions: 3 },
      { command: 'R', repetitions: 1 }
    ]);
    assert.strictEqual(result.bloques.length, 2);
    assert.strictEqual(result.numeroUnico.length, 10);
    assert.deepStrictEqual(result.bloques.map(b => b.command), ['F', 'R']);
    assert.deepStrictEqual(result.bloques.map(b => b.repeticiones), [3, 1]);
    assert.ok(result.numeroUnico.split('').every(c => c >= '0' && c <= '9'));
  });

  it('decodificarPrograma corta el string en bloques de 5 dígitos y clasifica', () => {
    const encoded = codificarPrograma([
      { command: 'F', repetitions: 3 },
      { command: 'R', repetitions: 1 }
    ]);
    const result = decodificarPrograma(encoded.numeroUnico);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.deepStrictEqual(result.decoded.map(d => d.command), ['F', 'R']);
    assert.deepStrictEqual(result.decoded.map(d => d.repetitions), [3, 1]);
    assert.strictEqual(result.bloques.length, 2);
    for (const block of result.bloques) {
      assert.strictEqual(block.classifiedAs, 'VALIDO');
    }
  });

  it('round-trip: codificar → decodificar preserva comandos y repeticiones', () => {
    const original = [
      { command: 'N', repetitions: 1 },
      { command: 'F', repetitions: 3 }, // Repetition here
      { command: 'B', repetitions: 1 },
      { command: 'O', repetitions: 1 },
      { command: 'C', repetitions: 1 },
      { command: 'P', repetitions: 1 }
    ];
    const encoded = codificarPrograma(original);
    const result = decodificarPrograma(encoded.numeroUnico);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.decoded.map(d => d.command), ['N', 'F', 'B', 'O', 'C', 'P']);
    assert.deepStrictEqual(result.decoded.map(d => d.repetitions), [1, 3, 1, 1, 1, 1]);
    assert.strictEqual(encoded.numeroUnico.length, 6 * 5);
  });

  it('decodificarPrograma con string vacío es inválido', () => {
    const result = decodificarPrograma('');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('vacío')));
  });

  it('decodificarPrograma con longitud no múltiplo de 5 es inválido', () => {
    const result = decodificarPrograma('102511'); // 6 digits
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('múltiplo de 5')));
  });

  it('decodificarPrograma rechaza bloque con mala repetición (ej: 0)', () => {
    const result = decodificarPrograma('10250');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('inválido')));
  });

  it('decodificarPrograma rechaza bloque en rango no divisible (FALSO)', () => {
    const result = decodificarPrograma('10001'); // 1000 is FALSE usually
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('FALSO')));
  });

  it('decodificarPrograma rechaza bloque corrupto (CORRUPTO)', () => {
    const result = decodificarPrograma('17631'); // 1763 is CORRUPTO usually
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('CORRUPTO')));
  });

});
