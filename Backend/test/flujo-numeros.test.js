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
        received.push(...msg.split(''));
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

describe('API HTTP - flujo de números encriptados (Transmisor → Receptor → Carro)', () => {

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

  it('GET /api/tabla devuelve la tabla de números autorizados', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/tabla`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Object.keys(data.tabla).length, 9);
    for (const entry of Object.values(data.tabla)) {
      assert.strictEqual(entry.numbers.length, 6);
    }
  });

  it('POST /api/programa-numeros sin carro conectado devuelve 409', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pasos: [{ numero: 1025, repeticiones: 1 }] })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 409);
    assert.ok(data.error.includes('No hay conexión con el carro'));
  });

  it('POST /api/programa-numeros con pasos vacío devuelve 400', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pasos: [] })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('array no vacío')));
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

  it('POST /api/programa-numeros descompone el número y el carro recibe la secuencia', async () => {
    const ssePromise = waitForSseEvent(appPort, 'STEP_SENT');
    await new Promise((r) => setTimeout(r, 30));

    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pasos: [{ numero: 1025, repeticiones: 3 }] })
    });
    const data = await res.json();

    assert.strictEqual(res.status, 202);
    assert.ok(data.sequenceId);
    assert.strictEqual(data.decoded[0].command, 'A');
    assert.strictEqual(data.decoded[0].numero, 1025);
    assert.strictEqual(data.totalSteps, 3);
    assert.strictEqual(data.esp32Sequence.map(s => s.char).join(''), 'FFF');
    assert.strictEqual(data.esp32Sequence[0].numero, 1025);

    const sseBlock = await ssePromise;
    assert.ok(sseBlock.includes('"message":"OK_AVANZAR:'));

    await waitFor(() => car.received.length >= 3);
    assert.strictEqual(car.received.join(''), 'FFF');

    await waitFor(() => app.auditService.getLogs().some(l => l.number === 1025));
    const log = app.auditService.getLogs().find(l => l.number === 1025);
    assert.strictEqual(log.command, 'A');
    assert.strictEqual(log.esp32Char, 'F');
    assert.strictEqual(log.classification, 'VALIDO');
  });

  it('POST /api/programa-numeros rechaza número no autorizado (FALSO) y audita', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pasos: [{ numero: 1000, repeticiones: 1 }] })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('FALSO')));
    await waitFor(() => app.auditService.getLogs().some(l => l.number === 1000 && l.classification === 'FALSO'));
  });

  it('POST /api/programa-numeros rechaza número corrupto (CORRUPTO)', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pasos: [{ numero: 1763, repeticiones: 1 }] })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('CORRUPTO')));
  });

  it('POST /api/programa-numeros rechaza repetición en comando de acción', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pasos: [{ numero: 1271, repeticiones: 2 }] })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('no acepta parámetro de repetición')));
  });

  it('POST /api/programa-numeros rechaza P que no sea el primer comando', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pasos: [
          { numero: 1025, repeticiones: 1 },
          { numero: 1271, repeticiones: 1 }
        ]
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes("'P' debe ser el primer comando")));
  });

  it('POST /api/programa-numeros rechaza número fuera del rango de 4 dígitos', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pasos: [{ numero: 41, repeticiones: 1 }] })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('4 dígitos')));
  });

});
