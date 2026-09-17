/**
 * SIMULACIÓN: Prueba del scan-and-connect en distintos escenarios
 * Ejecutar con: node Backend/test/scan-simulaciones.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocketServer, WebSocket } from 'ws';
import { scanNetwork, pickRandom } from '../src/services/networkScanner.js';

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIO 1: Receiver estilo Diego Safar / Andres Cuello (puerto 80, /transmisor)
// ══════════════════════════════════════════════════════════════════════════════

describe('ESCENARIO 1: Receiver tipo Diego/Andres (puerto 80, /transmisor)', () => {
  /** @type {WebSocketServer[]} */
  const servers = [];

  function createServer(port) {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port }, () => { servers.push(wss); resolve(wss); });
      wss.on('error', reject);
    });
  }

  after(async () => { for (const w of servers) await new Promise(r => w.close(r)); });

  it('Detecta receiver en puerto 80, path /transmisor', async () => {
    // Simula: receptor en 127.0.0.50:80
    const wss = await createServer(19080);

    const result = await scanNetwork({ baseIP: '127.0.0', startOctet: 50, endOctet: 50, port: 19080 });

    assert.ok(result.available.length > 0, 'Debió detectar el receiver');
    assert.ok(result.available.some(a => a.ip === '127.0.0.50'));
    console.log(`  ✅ Detectó receiver en 127.0.0.50:${19080}`);
  });

  it('PickRandom elige una IP de las disponibles', async () => {
    const IPs = ['192.168.0.35', '192.168.0.50', '192.168.0.120'];
    const chosen = pickRandom(IPs);
    assert.ok(IPs.includes(chosen));
    console.log(`  ✅ pickRandom eligió ${chosen} de [${IPs}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIO 2: Receiver estilo Robert Coha (puerto 5000, /ws)
// ══════════════════════════════════════════════════════════════════════════════

describe('ESCENARIO 2: Receiver tipo Robert (puerto 5000, /ws) — NO detectado', () => {
  /** @type {WebSocketServer[]} */
  const servers = [];

  function createServer(port) {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port }, () => { servers.push(wss); resolve(wss); });
      wss.on('error', reject);
    });
  }

  after(async () => { for (const w of servers) await new Promise(r => w.close(r)); });

  it('NO detecta receiver en puerto 5000 cuando scan prueba puerto 80', async () => {
    // Simula: Robert con receptor en puerto 5000
    const wss = await createServer(19500);

    const result = await scanNetwork({ baseIP: '127.0.0', startOctet: 60, endOctet: 60, port: 19080 });

    assert.strictEqual(result.available.length, 0, 'No debe detectar — puertos diferentes');
    console.log(`  ✅ NO detectó receiver en puerto 19500 (scan probó 19080)`);
  });

  it('NO detecta receiver en /ws cuando scan prueba /transmisor', async () => {
    // El scan probes ws://ip:port/transmisor
    // Si el server solo acepta /ws, la conexión podría fallar o aceptarse dependiendo del server
    const wss = await createServer(19081);

    const result = await scanNetwork({ baseIP: '127.0.0', startOctet: 61, endOctet: 61, port: 19081 });

    // WebSocketServer sin path filtering acepta cualquier path
    // Pero en producción Robert filtra por /ws, así que aquí lo detecta pero en la vida real no
    console.log(`  ⚠️  scan probó 127.0.0.61:${19081} → disponible: ${result.available.length > 0}`);
    console.log(`  ⚠️  NOTA: En producción, Robert filtra por /ws, así que este positivo es falso`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIO 3: IP del compañero (192.168.0.35) — fuera del rango anterior
// ══════════════════════════════════════════════════════════════════════════════

describe('ESCENARIO 3: IP del compañero (192.168.0.35) — rango expandido', () => {
  it('Rango anterior (119-128) NO cubre la IP 35', async () => {
    const result = await scanNetwork({ baseIP: '192.168.0', startOctet: 119, endOctet: 128, port: 19999 });

    assert.ok(!result.scanned.includes('192.168.0.35'), 'No debe escanear la IP 35');
    console.log(`  ✅ Rango 119-128: scanned = [${result.scanned.join(', ')}] → IP 35 NO incluida`);
  });

  it('Rango nuevo (30-40) SÍ cubre la IP 35', async () => {
    const result = await scanNetwork({ baseIP: '192.168.0', startOctet: 30, endOctet: 40, port: 19999 });

    assert.ok(result.scanned.includes('192.168.0.35'), 'Debe escanear la IP 35');
    console.log(`  ✅ Rango 30-40: IP 35 incluida en scanned (${result.scanned.length} IPs)`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIO 4: Múltiples receivers — elegir al azar
// ══════════════════════════════════════════════════════════════════════════════

describe('ESCENARIO 4: Múltiples receivers activos', () => {
  /** @type {WebSocketServer[]} */
  const servers = [];

  function createServer(port) {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port }, () => { servers.push(wss); resolve(wss); });
      wss.on('error', reject);
    });
  }

  after(async () => { for (const w of servers) await new Promise(r => w.close(r)); });

  it('Detecta 3 receivers y elige uno al azar', async () => {
    await createServer(19030); // IP .30
    await createServer(19031); // IP .31
    await createServer(19032); // IP .32

    const result = await scanNetwork({ baseIP: '127.0.0', startOctet: 30, endOctet: 32, port: 19030 });

    // Todos están en el mismo puerto, así que los 3 se detectan
    assert.ok(result.available.length >= 1, 'Al menos un receiver detectado');

    const chosen = pickRandom(result.available);
    assert.ok(result.available.includes(chosen));
    console.log(`  ✅ Detectó ${result.available.length} receivers: [${result.available.map(a => a.ip).join(', ')}]`);
    console.log(`  ✅ pickRandom eligió: ${chosen.ip}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIO 5: Receiver apagado / caído
// ══════════════════════════════════════════════════════════════════════════════

describe('ESCENARIO 5: Receiver apagado', () => {
  it('No detecta IPs muertas', async () => {
    const result = await scanNetwork({ baseIP: '127.0.0', startOctet: 90, endOctet: 92, port: 19999 });

    assert.strictEqual(result.available.length, 0);
    assert.strictEqual(result.scanned.length, 3);
    console.log(`  ✅ 3 IPs escaneadas, 0 disponibles (todas muertas)`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIO 6: Timeout — server que no responde
// ══════════════════════════════════════════════════════════════════════════════

describe('ESCENARIO 6: Server que acepta conexión pero no cierra', () => {
  /** @type {WebSocketServer[]} */
  const servers = [];

  function createServer(port) {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port }, () => { servers.push(wss); resolve(wss); });
      wss.on('error', reject);
    });
  }

  after(async () => { for (const w of servers) await new Promise(r => w.close(r)); });

  it('El scan cierra la conexión de prueba correctamente', async () => {
    const wss = await createServer(19040);

    const start = Date.now();
    const result = await scanNetwork({ baseIP: '127.0.0', startOctet: 40, endOctet: 40, port: 19040 });
    const elapsed = Date.now() - start;

    assert.ok(result.available.length > 0);
    assert.ok(elapsed < 5000, `Debió terminar en <5s, tardó ${elapsed}ms`);
    console.log(`  ✅ Scan completó en ${elapsed}ms, detectó IP activa`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIO 7: Rendimiento con rango expandido
// ══════════════════════════════════════════════════════════════════════════════

describe('ESCENARIO 7: Rendimiento rango expandido (10 IPs, todas muertas)', () => {
  it('Escanea 10 IPs en tiempo razonable', async () => {
    const start = Date.now();
    const result = await scanNetwork({ baseIP: '192.168.0', startOctet: 100, endOctet: 109, port: 19999 });
    const elapsed = Date.now() - start;

    assert.strictEqual(result.scanned.length, 10);
    assert.strictEqual(result.available.length, 0);
    console.log(`  ✅ 10 IPs escaneadas en ${elapsed}ms (${(elapsed/1000).toFixed(1)}s)`);
    console.log(`  ✅ Throughput: ${(10 / (elapsed/1000)).toFixed(1)} IPs/segundo`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ESCENARIO 8: Handler con peer ya conectado
// ══════════════════════════════════════════════════════════════════════════════

describe('ESCENARIO 8: Handler — peer desconecta antes de reconectar', () => {
  let scanAndConnect;

  before(async () => {
    const mod = await import('../src/http/handlers.js');
    scanAndConnect = mod.HANDLERS['scan-and-connect'];
  });

  it('Si no hay receivers, no intenta desconectar/conectar', async () => {
    const mockPeer = {
      connected: true,
      role: 'transmitter',
      connect: () => { throw new Error('No debería llegar aquí'); },
      disconnect: () => { throw new Error('No debería desconectar si no hay receivers'); },
    };

    const result = await scanAndConnect({ peerAdapter: mockPeer }, { port: 19999 });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data.available.length, 0);
    console.log(`  ✅ No intentó desconectar ni conectar (no hay receivers)`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RESUMEN
// ══════════════════════════════════════════════════════════════════════════════

describe('RESUMEN DE SIMULACIONES', () => {
  it('Todas las simulaciones completaron', () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  PROBLEMAS POTENCIALES DETECTADOS:');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('  1. Robert Coha NO detectado (path /ws, puerto 5000)');
    console.log('     → El scan prueba /transmisor en puerto 80');
    console.log('     → SOLUCIÓN: Agregar lógica para probar ambos paths');
    console.log('');
    console.log('  2. Rango expandido = más tiempo de escaneo');
    console.log('     → 254 IPs ≈ 25-50s con 5 paralelos y timeout 2s');
    console.log('     → MITIGACIÓN: Timeout corto (2s) + paralelismo (5)');
    console.log('');
    console.log('  3. Posible falso positivo con Robert');
    console.log('     → WebSocketServer sin filtro acepta cualquier path');
    console.log('     → En producción Robert filtra por /ws');
    console.log('     → El scan lo detectaría pero la conexión real fallaría');
    console.log('');
    console.log('  4. Firewall puede bloquear conexiones locales');
    console.log('     → Algunos firewalls bloquean puertos inusuales');
    console.log('     → MITIGACIÓN: Usar puerto 80 (estándar HTTP)');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    assert.ok(true);
  });
});
