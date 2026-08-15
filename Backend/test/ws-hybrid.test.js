import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import {
  buildRequest,
  CLIENT_PROTOCOL_VERSION
} from '../src/protocol/clientProtocol.js';

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/api`);
    let settled = false;

    function onOpen() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ws);
    }

    function onFail() {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('No se pudo conectar al servidor WebSocket'));
    }

    function cleanup() {
      ws.removeListener('open', onOpen);
      ws.removeListener('error', onFail);
      ws.removeListener('close', onFail);
    }

    ws.once('open', onOpen);
    ws.once('error', onFail);
    ws.once('close', onFail);
  });
}

function createQueue(ws) {
  const queue = [];
  const waiters = [];

  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    const waiterIndex = waiters.findIndex((w) => w.predicate(parsed));

    if (waiterIndex !== -1) {
      const waiter = waiters.splice(waiterIndex, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(parsed);
      return;
    }

    queue.push(parsed);
  });

  return {
    waitFor(predicate, timeoutMs = 2000) {
      const queuedIndex = queue.findIndex(predicate);

      if (queuedIndex !== -1) {
        return Promise.resolve(queue.splice(queuedIndex, 1)[0]);
      }

      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index !== -1) waiters.splice(index, 1);
            reject(new Error('Timeout esperando mensaje WebSocket'));
          }, timeoutMs)
        };
        waiters.push(waiter);
      });
    }
  };
}

let app, appPort, ws, queue;

describe('API híbrida - WebSocket /ws/api', () => {

  before(async () => {
    app = createApp({ stepDelay: 5 });
    await new Promise((resolve) => app.httpServer.listen(0, '127.0.0.1', () => resolve()));
    appPort = app.httpServer.address().port;
    ws = await connectWs(appPort);
    queue = createQueue(ws);
  });

  after(async () => {
    if (ws) ws.close();
    app.carService.disconnect();
    if (app.wsServer) app.wsServer.stop();
    await new Promise((resolve) => app.httpServer.close(() => resolve()));
  });

  it('request + response (health)', async () => {
    ws.send(buildRequest({ action: 'health', data: {}, requestId: 'r1' }));

    const msg = await queue.waitFor((m) => m.type === 'response' && m.requestId === 'r1');

    assert.strictEqual(msg.v, CLIENT_PROTOCOL_VERSION);
    assert.strictEqual(msg.type, 'response');
    assert.strictEqual(msg.requestId, 'r1');
    assert.strictEqual(msg.ok, true);
    assert.strictEqual(msg.status, 200);
    assert.strictEqual(msg.data.status, 'ok');
    assert.ok('carConnected' in msg.data);
    assert.ok('carAddress' in msg.data);
  });

  it('request con lógica de servicio (rangos)', async () => {
    ws.send(buildRequest({ action: 'rangos', data: {}, requestId: 'r2' }));

    const msg = await queue.waitFor((m) => m.type === 'response' && m.requestId === 'r2');

    assert.strictEqual(msg.ok, true);
    assert.strictEqual(msg.status, 200);
    assert.ok(msg.data.rangos);
    assert.strictEqual(Object.keys(msg.data.rangos).length, 9);
    assert.strictEqual(msg.data.rangos.F.min, 1000);
    assert.strictEqual(msg.data.rangos.F.max, 1999);
    assert.strictEqual(msg.data.rangos.M.max, 9999);
  });

  it('error status preservado (programa-numeros inválido)', async () => {
    ws.send(buildRequest({ action: 'programa-numeros', data: { programa: '123' }, requestId: 'r3' }));

    const msg = await queue.waitFor((m) => m.type === 'response' && m.requestId === 'r3');

    assert.strictEqual(msg.type, 'response');
    assert.strictEqual(msg.requestId, 'r3');
    assert.strictEqual(msg.ok, false);
    assert.strictEqual(msg.status, 400);
    assert.strictEqual(msg.error, null);
    assert.ok(msg.data.errors.length > 0);
  });

  it('event push sobre WS (dual push AUDIT_LOG)', async () => {
    ws.send(buildRequest({ action: 'classify', data: { number: 1025 }, requestId: 'r4' }));

    const response = await queue.waitFor((m) => m.type === 'response' && m.requestId === 'r4');

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data.classifiedAs, 'VALIDO');

    const event = await queue.waitFor((m) => m.type === 'event' && m.event === 'AUDIT_LOG');

    assert.strictEqual(event.event, 'AUDIT_LOG');
    assert.strictEqual(event.data.classification, 'VALIDO');
    assert.strictEqual(event.data.number, 1025);
  });

  it('ping/pong', async () => {
    ws.send(JSON.stringify({ v: CLIENT_PROTOCOL_VERSION, type: 'ping' }));

    const msg = await queue.waitFor((m) => m.type === 'pong');

    assert.strictEqual(msg.type, 'pong');
    assert.strictEqual(msg.v, CLIENT_PROTOCOL_VERSION);
  });

  it('mensaje malformado responde error', async () => {
    ws.send('esto no es json');

    const msg = await queue.waitFor((m) => m.type === 'error');

    assert.strictEqual(msg.type, 'error');
    assert.strictEqual(msg.message, 'Mensaje inválido');
  });

});