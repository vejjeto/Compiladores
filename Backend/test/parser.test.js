import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseCommands, getCommandInfo, COMMAND_MAP } from '../src/core/parser.js';

describe('Parser - parseCommands', () => {

  it('debe rechazar programa vacío', () => {
    const result = parseCommands('');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.includes('El programa está vacío'));
    assert.strictEqual(result.commands.length, 0);
  });

  it('debe rechazar null/undefined', () => {
    const result = parseCommands(null);
    assert.strictEqual(result.valid, false);
  });

  it('debe parsear comando simple válido', () => {
    const result = parseCommands('A');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 1);
    assert.strictEqual(result.commands[0].command, 'A');
    assert.strictEqual(result.commands[0].esp32Char, 'F');
    assert.strictEqual(result.commands[0].name, 'Avanzar');
  });

  it('debe parsear comando con repetición', () => {
    const result = parseCommands('A:3');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands[0].repetitions, 3);
    assert.strictEqual(result.esp32Sequence.length, 3);
  });

  it('debe parsear programa completo válido', () => {
    const result = parseCommands('P, A:3, R:2, D, O, C, F');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 7);
  });

  it('debe generar secuencia ESP32 correctamente', () => {
    const result = parseCommands('A:2, D');
    assert.strictEqual(result.esp32Sequence.length, 3);
    assert.strictEqual(result.esp32Sequence[0].char, 'F');
    assert.strictEqual(result.esp32Sequence[1].char, 'F');
    assert.strictEqual(result.esp32Sequence[2].char, 'R');
  });

  it('debe mapear cámara al protocolo real del carro (P→N, F→P)', () => {
    const result = parseCommands('P, A, F');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.esp32Sequence[0].char, 'N');
    assert.strictEqual(result.esp32Sequence[1].char, 'F');
    assert.strictEqual(result.esp32Sequence[2].char, 'P');
  });

  it('debe mapear todos los comandos al protocolo real del carro', () => {
    const result = parseCommands('A, R, D, I, O, C, M, P, F');
    const chars = result.esp32Sequence.map(s => s.char);
    assert.deepStrictEqual(chars, ['F', 'B', 'R', 'L', 'O', 'C', 'M', 'N', 'P']);
  });

  it('debe parsear el comando M (Liberar Control)', () => {
    const result = parseCommands('M');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 1);
    assert.strictEqual(result.commands[0].command, 'M');
    assert.strictEqual(result.commands[0].esp32Char, 'M');
    assert.strictEqual(result.commands[0].name, 'Liberar Control');
  });

  it('debe rechazar repetición en el comando M', () => {
    const result = parseCommands('M:2');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("no acepta parámetro de repetición")));
  });

  it('debe rechazar P que no sea primero', () => {
    const result = parseCommands('A, P');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("'P' debe ser el primer comando")));
  });

  it('debe rechazar F que no sea último', () => {
    const result = parseCommands('F, A');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("'F' debe ser el último comando")));
  });

  it('debe rechazar tokens inválidos', () => {
    const result = parseCommands('abc');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Token inválido')));
  });

  it('debe rechazar repetición en comandos de acción', () => {
    const result = parseCommands('O:2');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("no acepta parámetro de repetición")));
  });

  it('debe aceptar P como primer comando y F como último', () => {
    const result = parseCommands('P, A, F');
    assert.strictEqual(result.valid, true);
  });

  it('debe ignorar espacios extra', () => {
    const result = parseCommands('  A  ,  R  ,  D  ');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 3);
  });

  it('debe ignorar tokens vacíos entre comas', () => {
    const result = parseCommands('A,,R,,D');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 3);
  });

});

describe('Parser - getCommandInfo', () => {

  it('debe retornar info de comando válido', () => {
    const info = getCommandInfo('A');
    assert.deepStrictEqual(info, { esp32: 'F', name: 'Avanzar', type: 'movement' });
  });

  it('debe retornar null para comando desconocido', () => {
    const info = getCommandInfo('X');
    assert.strictEqual(info, null);
  });

});

describe('Parser - COMMAND_MAP', () => {

  it('debe tener todos los comandos definidos', () => {
    const expected = ['A', 'R', 'D', 'I', 'O', 'C', 'P', 'F', 'M'];
    for (const cmd of expected) {
      assert.ok(COMMAND_MAP[cmd], `Falta comando ${cmd}`);
    }
  });

});
