import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const PEER_PATH = '/ws/peer';

function openPeer(port, path = PEER_PATH) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);

  let resolveClose;
  const closePromise = new Promise((resolve) => { resolveClose = resolve; });
  ws.on('close', (code, reason) => resolveClose({ code, reason: reason.toString() }));
  ws.on('error', () => {});

  const openPromise = new Promise((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', (err) => reject(err));
  });
  openPromise.catch(() => {});

  return { ws, openPromise, closePromise };
}

async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor: condición no cumplida a tiempo');
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeoutMs))
  ]);
}

describe('Role lock — peers entrantes (backend)', () => {
  let app, port;

  before(async () => {
    app = createApp({ stepDelay: 5 });
    await new Promise((resolve) => app.httpServer.listen(0, '127.0.0.1', resolve));
    port = app.httpServer.address().port;
  });

  after(async () => {
    if (app.wsServer) app.wsServer.stop();
    await new Promise((resolve) => app.httpServer.close(() => resolve()));
  });

  it('acepta el primer peer entrante y rechaza el segundo en el handshake', async () => {
    const first = openPeer(port);
    await first.openPromise;
    await waitFor(() => app.wsServer.peerConnections.size === 1);
    assert.strictEqual(app.wsServer.peerConnections.size, 1);

    const second = openPeer(port);
    await withTimeout(
      assert.rejects(second.openPromise, /Unexpected server response: 503/),
      2000,
      'el segundo peer debe ser rechazado en el handshake'
    );
    assert.strictEqual(app.wsServer.peerConnections.size, 1);

    first.ws.close();
    await waitFor(() => app.wsServer.peerConnections.size === 0);
  });

  it('rechaza un peer entrante cuando hay una conexión saliente activa', async () => {
    const original = app.wsServer.ctx.peerAdapter;
    app.wsServer.ctx.peerAdapter = { connected: true };
    try {
      const peer = openPeer(port);
      await withTimeout(
        assert.rejects(peer.openPromise, /Unexpected server response: 503/),
        2000,
        'el peer entrante debe ser rechazado en el handshake'
      );
      assert.strictEqual(app.wsServer.peerConnections.size, 0);
    } finally {
      app.wsServer.ctx.peerAdapter = original;
    }
  });

  it('libera el lock del receptor al desconectarse el peer entrante', async () => {
    const first = openPeer(port);
    await first.openPromise;
    await waitFor(() => app.wsServer.peerConnections.size === 1);

    first.ws.close();
    await waitFor(() => app.wsServer.peerConnections.size === 0);

    const second = openPeer(port);
    await second.openPromise;
    await waitFor(() => app.wsServer.peerConnections.size === 1);
    assert.strictEqual(app.wsServer.peerConnections.size, 1);

    second.ws.close();
    await waitFor(() => app.wsServer.peerConnections.size === 0);
  });

  it('no limita ni rechaza las conexiones /monitor', async () => {
    const m1 = openPeer(port, '/monitor');
    const m2 = openPeer(port, '/monitor');
    await m1.openPromise;
    await m2.openPromise;
    await waitFor(() => app.wsServer.monitorConnections.size >= 2);
    assert.ok(app.wsServer.monitorConnections.size >= 2);

    m1.ws.close();
    m2.ws.close();
    await waitFor(() => app.wsServer.monitorConnections.size === 0);
  });
});

describe('Role lock — guardas en handlers (R3)', () => {
  let HANDLERS;

  before(async () => {
    ({ HANDLERS } = await import('../src/http/handlers.js'));
  });

  it('connect-peer devuelve 409 cuando hay un receptor entrante conectado', async () => {
    const ctx = {
      peerAdapter: { connect: () => { throw new Error('no debe intentar conectar'); } },
      wsServerAdapter: { peerConnections: new Set([{}]) }
    };

    const result = await HANDLERS['connect-peer'](ctx, { url: 'ws://192.168.0.51/ws' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.error, 'receptor-locked');
  });

  it('connect-peer conecta normalmente cuando no hay receptor entrante', async () => {
    let connectCalled = false;
    const ctx = {
      peerAdapter: {
        connect: async () => { connectCalled = true; return { ok: true, status: 'connected', address: '192.168.0.51:80' }; }
      },
      wsServerAdapter: { peerConnections: new Set() }
    };

    const result = await HANDLERS['connect-peer'](ctx, { url: 'ws://192.168.0.51/ws' });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(connectCalled, true);
  });

  it('connect-peer devuelve "receptor-ocupado" cuando el destino rechaza con 503', async () => {
    const ctx = {
      peerAdapter: { connect: async () => { throw new Error('Unexpected server response: 503'); } },
      wsServerAdapter: { peerConnections: new Set() }
    };

    const result = await HANDLERS['connect-peer'](ctx, { url: 'ws://192.168.0.51/ws' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.error, 'receptor-ocupado');
  });

  it('scan-and-connect devuelve 409 cuando hay un receptor entrante conectado', async () => {
    const ctx = {
      peerAdapter: { connected: false, connect: async () => {} },
      carService: { address: null, connected: false },
      wsServerAdapter: { peerConnections: new Set([{}]) }
    };

    const result = await HANDLERS['scan-and-connect'](ctx, { port: 19999, startOctet: 119, endOctet: 120 });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.error, 'receptor-locked');
  });
});
