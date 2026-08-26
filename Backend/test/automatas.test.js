import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  divisibilityAutomaton,
  getClassificationResults,
  countDivisibilities,
  getDivisiblePrimes
} from '../src/core/automatas.js';
import { tablaService } from '../src/services/tablaService.js';

tablaService.loadTableSync();

describe('Autómata - PRIMES', () => {

  it('debe contener 6 primos', () => {
    assert.strictEqual(tablaService.getPrimes().length, 6);
  });

  it('debe contener los primos correctos', () => {
    assert.deepStrictEqual(tablaService.getPrimes(), [41, 43, 47, 53, 59, 61]);
  });

});

describe('Autómata - divisibilityAutomaton', () => {

  it('debe detectar divisibilidad por 41', () => {
    assert.strictEqual(divisibilityAutomaton(41, 41), true);
    assert.strictEqual(divisibilityAutomaton(82, 41), true);
    assert.strictEqual(divisibilityAutomaton(83, 41), false);
  });

  it('debe detectar divisibilidad por 43', () => {
    assert.strictEqual(divisibilityAutomaton(43, 43), true);
    assert.strictEqual(divisibilityAutomaton(86, 43), true);
    assert.strictEqual(divisibilityAutomaton(87, 43), false);
  });

  it('debe detectar divisibilidad por 47', () => {
    assert.strictEqual(divisibilityAutomaton(47, 47), true);
    assert.strictEqual(divisibilityAutomaton(94, 47), true);
    assert.strictEqual(divisibilityAutomaton(95, 47), false);
  });

  it('debe retornar true para 0 (0 es divisible por todo)', () => {
    assert.strictEqual(divisibilityAutomaton(0, 41), true);
  });

});

describe('Autómata - getClassificationResults', () => {

  it('debe retornar resultados para todos los primos', () => {
    const results = getClassificationResults(41);
    const keys = Object.keys(results).map(Number);
    assert.deepStrictEqual(keys, tablaService.getPrimes());
  });

  it('debe clasificar correctamente un número divisible por 41', () => {
    const results = getClassificationResults(41);
    assert.strictEqual(results[41], true);
    assert.strictEqual(results[43], false);
    assert.strictEqual(results[47], false);
    assert.strictEqual(results[53], false);
    assert.strictEqual(results[59], false);
    assert.strictEqual(results[61], false);
  });

  it('debe clasificar correctamente un número no divisible', () => {
    const results = getClassificationResults(100);
    for (const prime of tablaService.getPrimes()) {
      assert.strictEqual(results[prime], false);
    }
  });

});

describe('Autómata - countDivisibilities', () => {

  it('debe contar 1 divisibilidad para número primo válido', () => {
    const results = getClassificationResults(41);
    assert.strictEqual(countDivisibilities(results), 1);
  });

  it('debe contar 0 divisibilidades para número no divisible', () => {
    const results = getClassificationResults(100);
    assert.strictEqual(countDivisibilities(results), 0);
  });

  it('debe contar múltiples divisibilidades', () => {
    const results = { 41: true, 43: true, 47: false, 53: true, 59: false, 61: false };
    assert.strictEqual(countDivisibilities(results), 3);
  });

});

describe('Autómata - getDivisiblePrimes', () => {

  it('debe retornar primos divisores', () => {
    const results = getClassificationResults(41);
    const divisible = getDivisiblePrimes(results);
    assert.deepStrictEqual(divisible, [41]);
  });

  it('debe retornar array vacío si no hay divisores', () => {
    const results = getClassificationResults(100);
    const divisible = getDivisiblePrimes(results);
    assert.deepStrictEqual(divisible, []);
  });

});
