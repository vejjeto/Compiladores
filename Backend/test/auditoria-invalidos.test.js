import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../server.js';
import { decodificarPrograma } from '../src/core/encriptador.js';

let app, appPort;

describe('Auditoría de bloques inválidos (classifiedAs INVALIDO)', () => {

  before(async () => {
    app = createApp({ stepDelay: 5 });
    await new Promise((resolve) => app.httpServer.listen(0, '127.0.0.1', () => resolve()));
    appPort = app.httpServer.address().port;
  });

  after(async () => {
    app.carService.disconnect();
    await new Promise((resolve) => app.httpServer.close(() => resolve()));
  });

  it('decodificarPrograma(\'0000\') marca el bloque como INVALIDO en classification y classifiedAs', () => {
    const result = decodificarPrograma('0000');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.bloques[0].classifiedAs, 'INVALIDO');
    assert.strictEqual(result.bloques[0].classification, 'INVALIDO');
    assert.strictEqual(result.bloques[0].command, null);
    assert.strictEqual(result.bloques[0].name, null);
  });

  it('decodificarPrograma(\'123a\') marca el bloque como INVALIDO en classification y classifiedAs', () => {
    const result = decodificarPrograma('123a');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.bloques[0].classifiedAs, 'INVALIDO');
    assert.strictEqual(result.bloques[0].classification, 'INVALIDO');
  });

  it('POST /api/programa-numeros con bloque inválido responde 400 y lo registra en el historial de auditoría', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: '0000' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.length > 0);

    const auditRes = await fetch(`http://127.0.0.1:${appPort}/api/audit`);
    const auditData = await auditRes.json();
    assert.strictEqual(auditRes.status, 200);

    const log = (auditData.logs || []).find(l => l.classification === 'INVALIDO' && l.source === 'programa-numeros');
    assert.ok(log, 'El bloque inválido debe quedar registrado en el historial de auditoría');
    assert.strictEqual(log.command, null);
    assert.strictEqual(log.commandName, null);
    assert.strictEqual(log.esp32Char, null);
  });

});