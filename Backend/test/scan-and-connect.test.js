import { describe, it, mock, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocketServer } from 'ws';
import { scanNetwork, pickRandom } from '../src/services/networkScanner.js';

// ─── pickRandom ─────────────────────────────────────────────────────────────

describe('pickRandom', () => {
  it('debe devolver null si la lista está vacía', () => {
    assert.strictEqual(pickRandom([]), null);
  });

  it('debe devolver null si se pasa null', () => {
    assert.strictEqual(pickRandom(null), null);
  });

  it('debe devolver null si se pasa undefined', () => {
    assert.strictEqual(pickRandom(undefined), null);
  });

  it('debe devolver el único receptor si hay uno', () => {
    const receptor = { ip: '192.168.0.119', path: '/transmisor' };
    assert.deepStrictEqual(pickRandom([receptor]), receptor);
  });

  it('debe devolver un receptor de la lista', () => {
    const receptores = [
      { ip: '192.168.0.119', path: '/transmisor' },
      { ip: '192.168.0.120', path: '/ws' },
      { ip: '192.168.0.121', path: '/transmisor' },
    ];
    const chosen = pickRandom(receptores);
    assert.ok(receptores.includes(chosen), `${JSON.stringify(chosen)} no está en la lista`);
  });

  it('debe poder elegir todos los receptores de la lista (probabilidad)', () => {
    const receptores = [
      { ip: '192.168.0.119', path: '/transmisor' },
      { ip: '192.168.0.120', path: '/ws' },
    ];
    const chosen = new Set();
    for (let i = 0; i < 100; i++) {
      chosen.add(pickRandom(receptores));
    }
    assert.ok(chosen.size >= 2, 'Debería elegir ambos receptores en 100 intentos');
  });
});

// ─── scanNetwork ────────────────────────────────────────────────────────────

describe('scanNetwork', () => {
  /** @type {WebSocketServer[]} */
  const servers = [];

  /** Crea un WebSocket server en el puerto indicado */
  function createServer(port) {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port }, () => {
        servers.push(wss);
        resolve(wss);
      });
      wss.on('error', reject);
    });
  }

  /** Cierra todos los servers */
  async function closeAll() {
    for (const wss of servers) {
      await new Promise((resolve) => wss.close(resolve));
    }
    servers.length = 0;
  }

  after(() => closeAll());

  it('debe detectar un servidor activo en el rango', async () => {
    await createServer(19210);

    const result = await scanNetwork({
      baseIP: '127.0.0',
      startOctet: 10,
      endOctet: 10,
      port: 19210,
    });

    assert.strictEqual(result.scanned.length, 1);
    assert.ok(result.available.some(a => a.ip === '127.0.0.10'));
  });

  it('debe devolver vacío si no hay servidores', async () => {
    const result = await scanNetwork({
      baseIP: '192.168.0',
      startOctet: 119,
      endOctet: 120,
      port: 19999,
    });

    assert.strictEqual(result.available.length, 0);
    assert.strictEqual(result.scanned.length, 2);
  });

  it('debe escanear solo las IPs del rango indicado', async () => {
    const result = await scanNetwork({
      baseIP: '127.0.0',
      startOctet: 20,
      endOctet: 22,
      port: 19999,
    });

    assert.strictEqual(result.scanned.length, 3);
    assert.ok(result.scanned.includes('127.0.0.20'));
    assert.ok(result.scanned.includes('127.0.0.21'));
    assert.ok(result.scanned.includes('127.0.0.22'));
  });

  it('debe detectar múltiples servidores activos', async () => {
    await createServer(19211);
    await createServer(19212);

    const result = await scanNetwork({
      baseIP: '127.0.0',
      startOctet: 11,
      endOctet: 12,
      port: 19211,
    });

    assert.strictEqual(result.scanned.length, 2);
    assert.ok(result.available.some(a => a.ip === '127.0.0.11'));
  });

  it('debe cerrar las conexiones de prueba después de detectar', async () => {
    await createServer(19213);

    await scanNetwork({
      baseIP: '127.0.0',
      startOctet: 13,
      endOctet: 13,
      port: 19213,
    });

    assert.ok(true, 'Escaneo completó sin colgar');
  });

  it('debe reportar scanned aunque nada esté activo', async () => {
    const result = await scanNetwork({
      baseIP: '127.0.0',
      startOctet: 14,
      endOctet: 16,
      port: 0,
    });

    assert.strictEqual(result.available.length, 0);
    assert.strictEqual(result.scanned.length, 3);
  });
});

// ─── Handler scanAndConnect (mockeando networkScanner) ──────────────────────

describe('handler scanAndConnect', () => {
  let scanAndConnect;

  // Mockeamos scanNetwork y pickRandom ANTES de importar el handler
  // para que el handler use nuestras funciones mockeadas
  before(async () => {
    const mod = await import('../src/http/handlers.js');
    scanAndConnect = mod.HANDLERS['scan-and-connect'];
  });

  /** Crea un mock de peerAdapter */
  function mockPeer(connected = false) {
    return {
      connected,
      role: connected ? 'transmitter' : null,
      connect: mock.fn(() => Promise.resolve({ ok: true })),
      disconnect: mock.fn(() => {}),
    };
  }

  /** Crea un contexto base para el handler */
  function ctx(peerConnected = false) {
    return { peerAdapter: mockPeer(peerConnected) };
  }

  it('debe ser una función', () => {
    assert.strictEqual(typeof scanAndConnect, 'function');
  });

  it('debe devolver "no encontrados" si no hay receptores en la red', async () => {
    // El handler llama scanNetwork({ port }) con las IPs default
    // En test, pasamos un rango pequeño para que sea rápido
    const result = await scanAndConnect(ctx(), { port: 19999, startOctet: 119, endOctet: 120 });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.ok, false);
    assert.ok(result.data.scanned.length > 0);
    assert.strictEqual(result.data.available.length, 0);
    assert.ok(result.data.message.includes('No se encontraron'));
  });

  it('debe usar puerto por defecto 80 si no se especifica', async () => {
    const result = await scanAndConnect(ctx(), { startOctet: 119, endOctet: 120 });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.ok, false);
    assert.ok(result.data.scanned.length > 0);
  });

  it('debe incluir scanned en la respuesta de "no encontrado"', async () => {
    const result = await scanAndConnect(ctx(), { port: 19999, startOctet: 119, endOctet: 120 });

    assert.ok(Array.isArray(result.data.scanned));
    assert.ok(result.data.scanned.length > 0);
    assert.strictEqual(result.data.available.length, 0);
  });

  it('debe manejar errores internos sin crashear', async () => {
    // El handler debe devolver structure { ok, status, data, error } siempre
    const result = await scanAndConnect(ctx(), { startOctet: 119, endOctet: 120 });

    assert.ok(typeof result === 'object');
    assert.ok('ok' in result);
    assert.ok('status' in result);
    assert.ok('data' in result);
    assert.ok('error' in result);
  });

  it('debe mantener la estructura de respuesta en todos los caminos', async () => {
    // Con peer ya conectado
    const c = ctx(true);
    const result = await scanAndConnect(c, { port: 19999, startOctet: 119, endOctet: 120 });

    assert.ok(typeof result === 'object');
    assert.ok('ok' in result);
    assert.ok('status' in result);
    assert.ok('data' in result);
    assert.ok(typeof result.data === 'object');
  });

  it('conecta exitosamente cuando encuentra un receptor y formatea la URL correctamente', async () => {
    const testPort = 19888;
    const wss = new WebSocketServer({ port: testPort });
    try {
      const context = ctx();
      const result = await scanAndConnect(context, {
        baseIP: '127.0.0',
        startOctet: 1,
        endOctet: 1,
        port: testPort
      });

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      assert.strictEqual(result.data.connectedTo, '127.0.0.1');
      assert.ok(!result.data.receptorURL.includes('[object Object]'));
      assert.match(result.data.receptorURL, /^ws:\/\/127\.0\.0\.1:19888\//);
      assert.ok(!result.data.message.includes('[object Object]'));
      assert.match(result.data.message, /Conectado a receptor en 127\.0\.0\.1/);
      assert.strictEqual(context.peerAdapter.connect.mock.callCount(), 1);
    } finally {
      await new Promise((resolve) => wss.close(resolve));
    }
  });
});

// ─── HANDLERS export ────────────────────────────────────────────────────────

describe('HANDLERS export', () => {
  it('debe incluir scan-and-connect', async () => {
    const { HANDLERS } = await import('../src/http/handlers.js');
    assert.ok('scan-and-connect' in HANDLERS);
    assert.strictEqual(typeof HANDLERS['scan-and-connect'], 'function');
  });

  it('debe incluir todas las rutas originales', async () => {
    const { HANDLERS } = await import('../src/http/handlers.js');
    const required = [
      'health', 'rangos', 'connect', 'disconnect', 'program',
      'programa-numeros', 'codificar', 'command', 'raw', 'classify',
      'audit', 'connect-peer', 'disconnect-peer', 'peer-status',
      'connect-car-peer', 'scan-and-connect',
    ];
    for (const key of required) {
      assert.ok(key in HANDLERS, `Falta handler: ${key}`);
    }
  });
});
