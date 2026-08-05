import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from '../server.js';

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

  it('POST /api/program sin carro conectado devuelve 409', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: 'P, A:3' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 409);
    assert.ok(data.error.includes('No hay conexión con el carro'));
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
    const res = await fetch(`http://127.0.0.1:${appPort}/api/program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: 'P, A:3, R:2, D, O, C, F' })
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
    assert.strictEqual(programLogs[0].command, 'P');
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
