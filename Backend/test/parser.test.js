import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseCommands, getCommandInfo } from '../src/core/parser.js';
import { tablaService } from '../src/services/tablaService.js';

tablaService.loadTableSync();

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
    const result = parseCommands('F');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 1);
    assert.strictEqual(result.commands[0].command, 'F');
    assert.strictEqual(result.commands[0].esp32Char, 'F');
    assert.strictEqual(result.commands[0].name, 'Avanzar');
  });

  it('debe parsear comando con repetición', () => {
    const result = parseCommands('F:3');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands[0].repetitions, 3);
    assert.strictEqual(result.esp32Sequence.length, 3);
  });

  it('debe parsear programa completo válido', () => {
    const result = parseCommands('N, F:3, B:2, R, O, C, P');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 7);
  });

  it('debe generar secuencia ESP32 correctamente', () => {
    const result = parseCommands('F:2, R');
    assert.strictEqual(result.esp32Sequence.length, 3);
    assert.strictEqual(result.esp32Sequence[0].char, 'F');
    assert.strictEqual(result.esp32Sequence[1].char, 'F');
    assert.strictEqual(result.esp32Sequence[2].char, 'R');
  });

  it('debe mapear cámara al protocolo real del carro (N al inicio, P al final)', () => {
    const result = parseCommands('N, F, P');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.esp32Sequence[0].char, 'N');
    assert.strictEqual(result.esp32Sequence[1].char, 'F');
    assert.strictEqual(result.esp32Sequence[2].char, 'P');
  });

  it('debe mapear todos los comandos al protocolo real del carro', () => {
    const result = parseCommands('F, B, R, L, O, C, M, N, P');
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

  it('debe rechazar N que no sea primero', () => {
    const result = parseCommands('F, N');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("'N' debe ser el primer comando")));
  });

  it('debe rechazar P que no sea último', () => {
    const result = parseCommands('P, F');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("'P' debe ser el último comando")));
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

  it('debe aceptar N como primer comando y P como último', () => {
    const result = parseCommands('N, F, P');
    assert.strictEqual(result.valid, true);
  });

  it('debe ignorar espacios extra', () => {
    const result = parseCommands('  F  ,  B  ,  R  ');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 3);
  });

  it('debe ignorar tokens vacíos entre comas', () => {
    const result = parseCommands('F,,B,,R');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.commands.length, 3);
  });

  it('debe aceptar punto y coma o espacios como separadores', () => {
    const r1 = parseCommands('F:2; B:3; L');
    assert.strictEqual(r1.valid, true);
    assert.strictEqual(r1.commands.length, 3);

    const r2 = parseCommands('F:2 B:3 L');
    assert.strictEqual(r2.valid, true);
    assert.strictEqual(r2.commands.length, 3);
  });

});

describe('Parser - getCommandInfo', () => {

  it('debe retornar info de comando válido', () => {
    const info = getCommandInfo('F');
    assert.deepStrictEqual(info, { esp32: 'F', name: 'Avanzar', type: 'movement', min: 1000, max: 1999 });
  });

  it('debe retornar null para comando desconocido', () => {
    const info = getCommandInfo('X');
    assert.strictEqual(info, null);
  });

});

describe('Parser - tablaService commands', () => {
  it('debe tener todos los comandos definidos', () => {
    const expected = ['F', 'B', 'R', 'L', 'O', 'C', 'N', 'P', 'M'];
    const commands = tablaService.getAllCommands();
    for (const cmd of expected) {
      assert.ok(commands[cmd], `Falta comando ${cmd}`);
    }
  });
});
