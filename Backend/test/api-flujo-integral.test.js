import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from '../server.js';
import { codificarPrograma } from '../src/core/encriptador.js';

function startMockCar() {
  return new Promise((resolve) => {
    const received = [];
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws) => {
      ws.send('Control asignado a tu IP');
      ws.on('message', (data) => {
        const msg = data.toString();
        for (const char of msg) {
          received.push(char);
          ws.send(`ACK:${char}`);
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, wss, received, port: server.address().port });
    });
  });
}

function waitFor(predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('Timeout esperando condición'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function waitForSseEvent(port, type, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/api/events`, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const blocks = buf.split('\n\n');
        for (const block of blocks) {
          const m = block.match(/^event: (\w+)\n([\s\S]*)$/);
          if (m && m[1] === type) {
            req.destroy();
            resolve(m[2]);
            return;
          }
        }
      });
    });
    req.on('error', reject);
    setTimeout(() => {
      req.destroy();
      reject(new Error(`Timeout esperando evento SSE ${type}`));
    }, timeout);
  });
}

let app, appPort, car, carPort;

describe('API HTTP - flujo integral (Transmisor → Backend → Carro)', () => {

  before(async () => {
    car = await startMockCar();
    carPort = car.port;

    app = createApp({ stepDelay: 5 });
    await new Promise((resolve) => app.httpServer.listen(0, '127.0.0.1', () => resolve()));
    appPort = app.httpServer.address().port;
  });

  after(async () => {
    app.carService.disconnect();
    await new Promise((resolve) => app.httpServer.close(() => resolve()));
    await new Promise((resolve) => car.wss.close(() => car.server.close(() => resolve())));
  });

  it('GET /api/health responde ok', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/health`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'ok');
  });

  it('POST /api/program sin carro conectado acepta y emite SEQUENCE_ERROR', async () => {
    const ssePromise = waitForSseEvent(appPort, 'SEQUENCE_ERROR');
    await new Promise((r) => setTimeout(r, 30));

    const res = await fetch(`http://127.0.0.1:${appPort}/api/program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: 'N, F:3' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 202);
    assert.ok(data.sequenceId);
    assert.strictEqual(data.valid, true);

    const sseBlock = await ssePromise;
    assert.ok(sseBlock.includes('no confirmó'));
  });

  it('POST /api/connect conecta al carro vía WebSocket', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: '127.0.0.1', port: carPort })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'connected');
  });

  it('GET /api/rangos devuelve los rangos autorizados por comando', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/rangos`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Object.keys(data.rangos).length, 9);
    assert.strictEqual(data.rangos.F.name, 'Avanzar');
    assert.strictEqual(data.rangos.M.max, 9999);
  });

  it('POST /api/codificar codifica un programa de comandos a número único', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/codificar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: 'F:2, R' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.numeroUnico.length, 10);
    assert.deepStrictEqual(data.bloques.map(b => b.command), ['F', 'R']);
  });

  it('POST /api/programa-numeros ejecuta un programa encriptado y el carro recibe la secuencia', async () => {
    const numeroUnico = codificarPrograma([
      { command: 'F', repetitions: 2 },
      { command: 'R', repetitions: 1 }
    ]).numeroUnico;

    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: numeroUnico })
    });
    const data = await res.json();

    assert.strictEqual(res.status, 202);
    assert.ok(data.sequenceId);
    assert.strictEqual(data.totalSteps, 3);
    assert.strictEqual(data.esp32Sequence.map(s => s.char).join(''), 'FFR');

    await waitFor(() => car.received.join('').endsWith('FFR'));
  });

  it('POST /api/classify clasifica un número y genera AUDIT_LOG', async () => {
    const ssePromise = waitForSseEvent(appPort, 'AUDIT_LOG');
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${appPort}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 1025 })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.classifiedAs, 'VALIDO');

    const sseBlock = await ssePromise;
    assert.ok(sseBlock.includes('"classification":"VALIDO"'));
  });

  it('POST /api/program ejecuta el programa y el carro recibe la secuencia exacta', async () => {
    car.received.length = 0;

    const res = await fetch(`http://127.0.0.1:${appPort}/api/program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: 'N, F:3, B:2, R, O, C, P' })
    });
    const data = await res.json();

    assert.strictEqual(res.status, 202);
    assert.ok(data.sequenceId);
    assert.strictEqual(data.totalSteps, 10);
    assert.strictEqual(data.esp32Sequence.map(s => s.char).join(''), 'NFFFBBROCP');

    await waitFor(() => car.received.length >= 10);
    assert.strictEqual(car.received.join(''), 'NFFFBBROCP');

    await waitFor(() => app.auditService.getLogs().length >= 11);
    const logs = app.auditService.getLogs();
    const programLogs = logs.filter(l => l.sequenceId === data.sequenceId);
    assert.strictEqual(programLogs.length, 10);
    assert.ok(programLogs.every(l => l.classification === 'VALIDO'));
    assert.strictEqual(programLogs[0].command, 'N');
    assert.strictEqual(programLogs[0].esp32Char, 'N');
  });

  it('POST /api/program con programa inválido devuelve 400', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: 'X, Y:0, P' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.valid, false);
    assert.ok(data.errors.length > 0);
  });

  it('POST /api/raw envía un char crudo directo al carro', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ char: 'M' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.char, 'M');

    await waitFor(() => car.received.join('').endsWith('M'));
  });

  it('POST /api/disconnect desconecta el carro', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'disconnected');
  });

  it('ruta desconocida devuelve 404', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/noexiste`);
    assert.strictEqual(res.status, 404);
  });

});
