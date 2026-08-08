import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from '../server.js';
import { codificarPrograma } from '../src/core/encriptador.js';

function programaDe(...items) {
  return codificarPrograma(
    items.map((item) => (
      typeof item === 'string' ? { command: item, repetitions: 1 } : item
    ))
  ).numeroUnico;
}

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

  it('GET /api/rangos devuelve los rangos autorizados por comando', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/rangos`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Object.keys(data.rangos).length, 9);
    assert.strictEqual(data.rangos.F.min, 1000);
    assert.strictEqual(data.rangos.F.max, 1999);
    assert.strictEqual(data.rangos.M.min, 9000);
    assert.strictEqual(data.rangos.M.max, 9999);
  });

  it('POST /api/programa-numeros sin carro conectado acepta y emite SEQUENCE_ERROR', async () => {
    const ssePromise = waitForSseEvent(appPort, 'SEQUENCE_ERROR');
    await new Promise((r) => setTimeout(r, 30));

    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: programaDe('F') })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 202);
    assert.ok(data.sequenceId);
    assert.strictEqual(data.valid, true);

    const sseBlock = await ssePromise;
    assert.ok(sseBlock.includes('no confirmó'));
  });

  it('POST /api/programa-numeros con programa vacío devuelve 400', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: '' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('no vacío')));
  });

  it('POST /api/programa-numeros con programa sin múltiplo de 4 devuelve 400', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: '10251' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('múltiplo de 4')));
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

  it('POST /api/programa-numeros descompone el programa y el carro recibe la secuencia', async () => {
    const ssePromise = waitForSseEvent(appPort, 'STEP_SENT');
    await new Promise((r) => setTimeout(r, 30));

    const numeroUnico = programaDe({ command: 'F', repetitions: 3 }, 'R');

    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: numeroUnico })
    });
    const data = await res.json();

    assert.strictEqual(res.status, 202);
    assert.ok(data.sequenceId);
    assert.deepStrictEqual(data.decoded.map(d => d.command), ['F', 'F', 'F', 'R']);
    assert.strictEqual(data.totalSteps, 4);
    assert.strictEqual(data.esp32Sequence.map(s => s.char).join(''), 'FFFR');
    assert.ok(data.esp32Sequence.every(s => s.numero != null));
    assert.strictEqual(data.esp32Sequence[0].numero, Number(numeroUnico.slice(0, 4)));

    const sseBlock = await ssePromise;
    assert.ok(sseBlock.includes('"message":"OK_AVANZAR:'));

    await waitFor(() => car.received.length >= 4);
    assert.strictEqual(car.received.join(''), 'FFFR');

    await waitFor(() => app.auditService.getLogs().some(l => l.number === data.esp32Sequence[0].numero));
    const log = app.auditService.getLogs().find(l => l.number === data.esp32Sequence[0].numero);
    assert.strictEqual(log.command, 'F');
    assert.strictEqual(log.esp32Char, 'F');
    assert.strictEqual(log.classification, 'VALIDO');
  });

  it('POST /api/programa-numeros rechaza bloque no autorizado (FALSO) y audita', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: `1000${programaDe('F')}` })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('FALSO')));
    await waitFor(() => app.auditService.getLogs().some(l => l.number === 1000 && l.classification === 'FALSO'));
  });

  it('POST /api/programa-numeros rechaza bloque corrupto (CORRUPTO)', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: '1763' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('CORRUPTO')));
  });

  it('POST /api/programa-numeros rechaza N que no sea el primer comando', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: programaDe('F', 'N') })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes("'N' debe ser el primer comando")));
  });

  it('POST /api/codificar devuelve el número único y sus bloques', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/codificar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: 'F:3, R' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.bloques.length, 4);
    assert.strictEqual(data.numeroUnico.length, 16);
    assert.deepStrictEqual(data.bloques.map(b => b.command), ['F', 'F', 'F', 'R']);

    const run = await fetch(`http://127.0.0.1:${appPort}/api/programa-numeros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programa: data.numeroUnico })
    });
    const runData = await run.json();
    assert.strictEqual(run.status, 202);
    assert.strictEqual(runData.totalSteps, 4);
    assert.deepStrictEqual(runData.decoded.map(d => d.command), ['F', 'F', 'F', 'R']);
  });

  it('POST /api/codificar con programa inválido devuelve 400', async () => {
    const res = await fetch(`http://127.0.0.1:${appPort}/api/codificar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: 'O:2' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.some(e => e.includes('no acepta parámetro de repetición')));
  });

});
