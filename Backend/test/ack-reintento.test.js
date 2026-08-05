import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from '../server.js';

function startMockCar({ ack = true } = {}) {
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
          if (ack) ws.send(`ACK:${char}`);
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

function waitForSseEvent(port, type, timeout = 10000) {
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

describe('Confirmación ACK y reintento (regla de espera del documento)', () => {

  before(async () => {
    car = await startMockCar({ ack: true });
    carPort = car.port;

    app = createApp({ stepDelay: 5, ackTimeout: 1000, maxRetries: 3 });
    await new Promise((resolve) => app.httpServer.listen(0, '127.0.0.1', () => resolve()));
    appPort = app.httpServer.address().port;
  });

  after(async () => {
    app.carService.disconnect();
    await new Promise((resolve) => app.httpServer.close(() => resolve()));
    await new Promise((resolve) => car.wss.close(() => car.server.close(() => resolve())));
  });

  it('acepta el formato de la consigna { numero, repeticiones, timestamp }', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: '127.0.0.1', port: carPort })
    });
    assert.strictEqual(res.status, 200);

    const run = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: 1025, repeticiones: 2, timestamp: '2026-07-22 10:30:00' })
    });
    const data = await run.json();
    assert.strictEqual(run.status, 202);
    assert.ok(data.sequenceId);
    assert.strictEqual(data.totalSteps, 2);

    await waitFor(() => car.received.length >= 2);
    assert.strictEqual(car.received.join(''), 'FF');
  });

  it('no emite STEP_RETRY cuando el carro confirma con ACK', async () => {
    car.received.length = 0;

    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: 1271, repeticiones: 1 })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 202);

    await waitFor(() => car.received.length >= 1);
    assert.strictEqual(car.received.join(''), 'N');
  });

  it('reintenta hasta el máximo y emite SEQUENCE_ERROR cuando el carro no responde ACK', async () => {
    const silentCar = await startMockCar({ ack: false });

    const app2 = createApp({ stepDelay: 5, ackTimeout: 40, maxRetries: 3 });
    await new Promise((resolve) => app2.httpServer.listen(0, '127.0.0.1', () => resolve()));
    const app2Port = app2.httpServer.address().port;

    try {
      await fetch(`http://127.0.0.1:${app2Port}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: '127.0.0.1', port: silentCar.port })
      });

      const retryPromise = waitForSseEvent(app2Port, 'STEP_RETRY');
      const errorPromise = waitForSseEvent(app2Port, 'SEQUENCE_ERROR');
      await new Promise((r) => setTimeout(r, 30));

      const res = await fetch(`http://127.0.0.1:${app2Port}/api/programa-numeros`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero: 1025, repeticiones: 1 })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 202);

      const retryBlock = await retryPromise;
      assert.ok(retryBlock.includes('"attempt":1'));

      const errorBlock = await errorPromise;
      assert.ok(errorBlock.includes('"step":1'));
      assert.ok(errorBlock.includes('3 intentos'));

      await waitFor(() => silentCar.received.length >= 3);
      assert.strictEqual(silentCar.received.join(''), 'FFF');
    } finally {
      app2.carService.disconnect();
      await new Promise((resolve) => app2.httpServer.close(() => resolve()));
      await new Promise((resolve) => silentCar.wss.close(() => silentCar.server.close(() => resolve())));
    }
  });

});
