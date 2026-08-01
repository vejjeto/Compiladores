import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NUMBER_TABLE, selectRandomNumber, getCommandByNumber, classifyNumber } from '../src/core/encriptador.js';

describe('Encriptador - NUMBER_TABLE', () => {

  it('debe tener 9 comandos con 6 números cada uno (54 en total)', () => {
    assert.strictEqual(Object.keys(NUMBER_TABLE).length, 9);
    for (const [cmd, data] of Object.entries(NUMBER_TABLE)) {
      assert.strictEqual(data.numbers.length, 6, `Comando ${cmd} debe tener 6 números`);
    }
  });

  it('todos los números deben ser únicos', () => {
    const all = Object.values(NUMBER_TABLE).flatMap(d => d.numbers);
    assert.strictEqual(new Set(all).size, all.length);
  });

  it('todos los números de la tabla deben clasificarse como VALIDO y apuntar a su comando', () => {
    for (const [cmd, data] of Object.entries(NUMBER_TABLE)) {
      for (const num of data.numbers) {
        const result = classifyNumber(num);
        assert.strictEqual(result.classifiedAs, 'VALIDO', `N°${num} debe ser VALIDO`);
        assert.strictEqual(result.command, cmd, `N°${num} debe pertenecer a ${cmd}`);
        assert.strictEqual(result.divisibleCount, 1, `N°${num} debe ser divisible por exactamente 1 primo`);
      }
    }
  });

  it('un número fuera de tabla y no divisible debe ser FALSO', () => {
    const result = classifyNumber(100);
    assert.strictEqual(result.classifiedAs, 'FALSO');
  });

  it('un número divisible por varios primos debe ser CORRUPTO', () => {
    const corrupt = 41 * 43;
    const result = classifyNumber(corrupt);
    assert.strictEqual(result.classifiedAs, 'CORRUPTO');
    assert.strictEqual(result.divisibleCount, 2);
  });

});

describe('Encriptador - selectRandomNumber / getCommandByNumber', () => {

  it('selectRandomNumber debe devolver un número del comando indicado', () => {
    const num = selectRandomNumber('A');
    assert.ok(NUMBER_TABLE.A.numbers.includes(num));
  });

  it('selectRandomNumber con comando desconocido devuelve null', () => {
    assert.strictEqual(selectRandomNumber('X'), null);
  });

  it('getCommandByNumber debe devolver el comando del número', () => {
    const result = getCommandByNumber(1025);
    assert.deepStrictEqual(result, { command: 'A', name: 'Avanzar' });
  });

  it('getCommandByNumber con número fuera de tabla devuelve null', () => {
    assert.strictEqual(getCommandByNumber(1), null);
  });

});
