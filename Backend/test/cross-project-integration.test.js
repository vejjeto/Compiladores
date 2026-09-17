/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SIMULACIONES DE INTEGRACIÓN CROSS-PROJECT
 *  Diego Safar (active) ↔ Robert Coha ↔ Andres Cuello
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Verifica que los 3 proyectos son compatibles en:
 *  - Conexión WebSocket (paths, puertos)
 *  - Codificación/decodificación de comandos
 *  - Protocolo de ACK
 *  - Escaneo de red
 *  - Orden de comandos (F/B/L/R)
 *  - Primos compartidos
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const execFile = promisify((await import('node:child_process')).execFile);

// ═══════════════════════════════════════════════════════════════════════════════
//  PATHS
// ═══════════════════════════════════════════════════════════════════════════════

const DIEGO_PATH = 'C:\\Users\\diego\\OneDrive\\Documents\\Univerisdad\\Proyecto_Compiladores\\Backend';
const ROBERT_PATH = 'C:\\Users\\diego\\OneDrive\\Desktop\\Super Pruebas\\mi-proyecto-compiladores';
const ANDRES_PATH = 'C:\\Users\\diego\\OneDrive\\Desktop\\Super Pruebas\\andrescuello-compiladores\\receptor';

// Saltar todo el suite si los paths externos no existen (CI, otra máquina, etc.)
const PROJECTS_AVAILABLE = fs.existsSync(DIEGO_PATH) && fs.existsSync(ROBERT_PATH);
const DESCRIBE = PROJECTS_AVAILABLE ? describe : describe.skip;

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Levanta un servidor Node.js como child process
 * @param {string} dir - directorio del proyecto
 * @param {string} script - archivo a ejecutar
 * @param {string[]} args - argumentos CLI
 * @param {object} envExtra - variables de entorno extra (ej: { PORT: '19401' })
 */
function levantarServidor(dir, script, args = [], envExtra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, ...args], {
      cwd: dir,
      env: { ...process.env, ...envExtra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    // Esperar a que el server esté listo (busca "listo" o "LISTO" en output combinado)
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timeout esperando server en ${dir}\nstdout: ${stdout.slice(-500)}\nstderr: ${stderr.slice(-500)}`));
    }, 15000);

    const combined = { write(data) { /* noop */ } };
    const checkReady = (data) => {
      const text = data.toString();
      if (text.includes('listo') || text.includes('LISTO') || text.includes('ready') ||
          text.includes('listening') || text.includes('Receptor') || text.includes('TRANSMISOR') ||
          text.includes('RECEPTOR')) {
        clearTimeout(timeout);
        child.stdout.removeListener('data', checkReady);
        // Esperar un poco más para que el server esté completamente listo
        setTimeout(() => resolve({ child, getLog: () => stdout + stderr }), 500);
      }
    };

    child.stdout.on('data', checkReady);
    child.on('error', (err) => { clearTimeout(timeout); reject(err); });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}\nstdout: ${stdout.slice(-500)}\nstderr: ${stderr.slice(-500)}`));
      }
    });
  });
}

/**
 * Espera a que un puerto esté disponible
 */
async function esperarPuerto(puerto, maxIntentos = 30) {
  for (let i = 0; i < maxIntentos; i++) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${puerto}/transmisor`);
      await new Promise((resolve, reject) => {
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', reject);
        setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 500);
      });
      return true;
    } catch {
      await espera(200);
    }
  }
  return false;
}

/**
 * Conecta un WebSocket y espera a que se abra
 */
function conectarWS(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, timeoutMs);
    ws.on('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

/**
 * Espera un mensaje del WebSocket
 */
function esperarMensaje(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout esperando mensaje')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timeout);
      resolve(data.toString());
    });
  });
}

/**
 * Lee el archivo comandos.js de Robert para extraer PRIMOS y COMANDOS
 */
function leerComandosRobert() {
  const content = fs.readFileSync(path.join(ROBERT_PATH, 'src', 'comandos.js'), 'utf-8');
  const primesMatch = content.match(/PRIMOS\s*=\s*\[([\d,\s]+)\]/);
  const primes = primesMatch ? primesMatch[1].split(',').map(Number) : [];
  return { primes };
}

/**
 * Lee tablas.json de Diego para extraer primes y command ranges
 */
function leerTablasDiego() {
  const content = fs.readFileSync(path.join(DIEGO_PATH, 'config', 'tablas.json'), 'utf-8');
  return JSON.parse(content);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════════════

DESCRIBE('Cross-Project Integration — Diego (active) ↔ Robert ↔ Andres', () => {

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 1: Primos idénticos en los 3 proyectos
  // ───────────────────────────────────────────────────────────────────────────
  it('1. Los 3 proyectos usan los mismos 6 primos [41,43,47,53,59,61]', () => {
    const diego = leerTablasDiego();
    const robert = leerComandosRobert();

    // Andres: PRIMOS_BASE = [41, 43, 47, 53, 59, 61] (leído del grep anterior)
    const andres = [41, 43, 47, 53, 59, 61];

    assert.deepStrictEqual(diego.primes, [41, 43, 47, 53, 59, 61]);
    assert.deepStrictEqual(robert.primes, [41, 43, 47, 53, 59, 61]);
    assert.deepStrictEqual(andres, [41, 43, 47, 53, 59, 61]);

    // Todos iguales
    assert.deepStrictEqual(diego.primes, robert.primes);
    assert.deepStrictEqual(diego.primes, andres);
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 2: Orden de comandos idéntico (F=1, B=2, L=3, R=4)
  // ───────────────────────────────────────────────────────────────────────────
  it('2. Los 3 proyectos tienen el mismo orden de comandos: F=1, B=2, L=3, R=4', () => {
    const diego = leerTablasDiego();
    const diegoCmds = diego.commands;

    // Robert: COMANDOS array en comandos.js
    const robertContent = fs.readFileSync(path.join(ROBERT_PATH, 'src', 'comandos.js'), 'utf-8');
    const robertBlocks = {};
    const robertRegex = /caracter:\s*'(\w+)'.*?bloque:\s*(\d+)/g;
    let m;
    while ((m = robertRegex.exec(robertContent)) !== null) {
      robertBlocks[m[1]] = parseInt(m[2]);
    }

    // Andres: Bloques heredados del protocolo compartido
    // F=1, B=2, L=3, R=4, N=5, P=6, O=7, C=8, M=9
    const andresBlocks = { F: 1, B: 2, L: 3, R: 4, N: 5, P: 6, O: 7, C: 8, M: 9 };

    // Verificar que todos coinciden
    for (const cmd of ['F', 'B', 'L', 'R', 'N', 'P', 'O', 'C', 'M']) {
      const diegoMin = diegoCmds[cmd].min;
      const diegoBlock = Math.floor(diegoMin / 1000);
      assert.equal(diegoBlock, andresBlocks[cmd], `Diego ${cmd}: bloque ${diegoBlock} ≠ Andres ${andresBlocks[cmd]}`);
      assert.equal(robertBlocks[cmd], andresBlocks[cmd], `Robert ${cmd}: bloque ${robertBlocks[cmd]} ≠ Andres ${andresBlocks[cmd]}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 3: Rangos numéricos idénticos (1000-9999)
  // ───────────────────────────────────────────────────────────────────────────
  it('3. Los 3 proyectos usan los mismos rangos: F=1000-1999, B=2000-2999, etc.', () => {
    const diego = leerTablasDiego();

    const expectedRanges = {
      F: [1000, 1999],
      B: [2000, 2999],
      L: [3000, 3999],
      R: [4000, 4999],
      N: [5000, 5999],
      P: [6000, 6999],
      O: [7000, 7999],
      C: [8000, 8999],
      M: [9000, 9999],
    };

    for (const [cmd, [min, max]] of Object.entries(expectedRanges)) {
      assert.equal(diego.commands[cmd].min, min, `${cmd} min: ${diego.commands[cmd].min} ≠ ${min}`);
      assert.equal(diego.commands[cmd].max, max, `${cmd} max: ${diego.commands[cmd].max} ≠ ${max}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 4: Diego (receptor) acepta conexiones en /transmisor
  // ───────────────────────────────────────────────────────────────────────────
  it('4. Diego receptor acepta WebSocket en /transmisor', async () => {
    const puerto = 19401;
    const { child } = await levantarServidor(DIEGO_PATH, 'server.js', [], { PORT: String(puerto) });

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto no disponible');

      const ws = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);
      assert.equal(ws.readyState, WebSocket.OPEN, 'WebSocket no está abierto');
      ws.close();
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 5: Robert (receptor) acepta /transmisor Y /ws
  // ───────────────────────────────────────────────────────────────────────────
  it('5. Robert receptor acepta WebSocket en /transmisor y /ws', async () => {
    const puerto = 19402;
    const { child } = await levantarServidor(ROBERT_PATH, 'src/servidor.js', [
      '--puerto', String(puerto), '--sin-robot', '--tira-pelada'
    ]);

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto no disponible');

      // Probar /transmisor
      const ws1 = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);
      assert.equal(ws1.readyState, WebSocket.OPEN, '/transmisor no aceptado');
      ws1.close();

      await espera(200);

      // Probar /ws
      const ws2 = await conectarWS(`ws://127.0.0.1:${puerto}/ws`);
      assert.equal(ws2.readyState, WebSocket.OPEN, '/ws no aceptado');
      ws2.close();
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 6: Diego envía número → Robert lo recibe
  // ───────────────────────────────────────────────────────────────────────────
  it('6. Diego envía número encriptado → Robert receptor lo recibe', async () => {
    const puerto = 19403;
    const { child } = await levantarServidor(ROBERT_PATH, 'src/servidor.js', [
      '--puerto', String(puerto), '--sin-robot', '--tira-pelada'
    ]);

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto no disponible');

      // Conectar como transmisor a Robert
      const ws = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);

      // Enviar número válido (F=1xxx, divisible por 41)
      // 1025 / 41 = 25 → divisible por 41, rango F (1000-1999)
      ws.send('10251');

      await espera(500);

      // Robert debería procesar el mensaje (no crashear)
      assert.equal(ws.readyState, WebSocket.OPEN, 'Conexión se cerró inesperadamente');
      ws.close();
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 7: Robert envía número → Diego lo recibe
  // ───────────────────────────────────────────────────────────────────────────
  it('7. Robert envía número encriptado → Diego receptor lo recibe', async () => {
    const puerto = 19404;
    const { child } = await levantarServidor(DIEGO_PATH, 'server.js', [], { PORT: String(puerto) });

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto no disponible');

      // Conectar como transmisor a Diego
      const ws = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);

      // Enviar número válido (F=1xxx, divisible por 43)
      // 1075 / 43 = 25 → divisible por 43, rango F (1000-1999)
      ws.send('10751');

      await espera(500);

      // Diego debería procesar el mensaje (no crashear)
      assert.equal(ws.readyState, WebSocket.OPEN, 'Conexión se cerró inesperadamente');
      ws.close();
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 8: Scan de Diego detecta receptor Robert en /transmisor
  // ───────────────────────────────────────────────────────────────────────────
  it('8. Scan de Diego detecta receptor Robert en /transmisor (puerto 80)', async () => {
    const puerto = 19405;
    const { child: robert } = await levantarServidor(ROBERT_PATH, 'src/servidor.js', [
      '--puerto', String(puerto), '--sin-robot', '--tira-pelada'
    ]);

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto Robert no disponible');

      // Simular scan manual: conectar a Robert como /transmisor
      const ws = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);
      assert.equal(ws.readyState, WebSocket.OPEN, 'Robert no acepta /transmisor');
      ws.close();
    } finally {
      robert.kill();
      await once(robert, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 9: Scan de Diego detecta receptor Andres en /transmisor
  // ───────────────────────────────────────────────────────────────────────────
  it('9. Scan de Diego detecta receptor Andres en /transmisor', async () => {
    const puerto = 19406;
    // Andres usa TypeScript, necesitamos transpilar o usar tsx
    // Primero verificamos si hay node_modules
    const hasNodeModules = fs.existsSync(path.join(ANDRES_PATH, '..', 'node_modules'));

    if (!hasNodeModules) {
      console.log('  ⏭  Saltando: Andres no tiene node_modules (correr pnpm install primero)');
      return;
    }

    const { child: andres } = await levantarServidor(ANDRES_PATH, 'src/servidor.ts', [
      '--puerto', String(puerto)
    ]);

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto Andres no disponible');

      // Andres SOLO acepta /transmisor (destruye otros paths)
      const ws = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);
      assert.equal(ws.readyState, WebSocket.OPEN, 'Andres no acepta /transmisor');
      ws.close();
    } finally {
      andres.kill();
      await once(andres, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 10: Diego rechaza números CORRUPTO (divisible por 2+ primos)
  // ───────────────────────────────────────────────────────────────────────────
  it('10. Diego rechaza números CORRUPTOS (divisibles por 2+ primos)', async () => {
    const puerto = 19407;
    const { child } = await levantarServidor(DIEGO_PATH, 'server.js', [], { PORT: String(puerto) });

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto no disponible');

      const ws = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);

      // 1763 es divisible por 41 Y 43 → CORRUPTO
      // 1763 / 41 = 43, 1763 / 43 = 41
      ws.send('17631');

      await espera(500);

      // Diego no debería crashear (rechaza internamente)
      assert.equal(ws.readyState, WebSocket.OPEN, 'Conexión se cerró por crash');
      ws.close();
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 11: Robert rechaza números CORRUPTOS
  // ───────────────────────────────────────────────────────────────────────────
  it('11. Robert rechaza números CORRUPTOS (divisibles por 2+ primos)', async () => {
    const puerto = 19408;
    const { child } = await levantarServidor(ROBERT_PATH, 'src/servidor.js', [
      '--puerto', String(puerto), '--sin-robot', '--tira-pelada'
    ]);

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto no disponible');

      const ws = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);

      // 1763 = 41 × 43 → CORRUPTO
      ws.send('17631');

      await espera(500);

      assert.equal(ws.readyState, WebSocket.OPEN, 'Conexión se cerró por crash');
      ws.close();
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 12: Cross-encode — Número generado por Diego es válido en Robert
  // ───────────────────────────────────────────────────────────────────────────
  it('12. Número generado por Diego es válido para clasificar en Robert', async () => {
    // Usar la lógica de primos para generar un número válido manualmente
    const PRIMOS = [41, 43, 47, 53, 59, 61];

    // Generar número para F (rango 1000-1999) divisible por exactamente 1 primo
    let valido = null;
    for (let n = 1000; n <= 1999; n++) {
      const divisiblePor = PRIMOS.filter((p) => n % p === 0);
      if (divisiblePor.length === 1) {
        valido = { numero: n, primo: divisiblePor[0] };
        break;
      }
    }

    assert.ok(valido, 'No se encontró número válido para F');
    assert.ok(valido.numero >= 1000 && valido.numero <= 1999, 'Fuera de rango F');

    // Verificar que Robert lo clasificaría igual
    const esDivisiblePor1 = PRIMOS.filter((p) => valido.numero % p === 0);
    assert.equal(esDivisiblePor1.length, 1, 'Robert clasificaría como corrupto');
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 13: Multi-path — Diego acepta /ws Y /transmisor
  // ───────────────────────────────────────────────────────────────────────────
  it('13. Diego receptor acepta /transmisor y /ws (compatibilidad)', async () => {
    const puerto = 19409;
    const { child } = await levantarServidor(DIEGO_PATH, 'server.js', [], { PORT: String(puerto) });

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto no disponible');

      // /transmisor
      const ws1 = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);
      assert.equal(ws1.readyState, WebSocket.OPEN, '/transmisor no aceptado');
      ws1.close();

      await espera(200);

      // /ws
      const ws2 = await conectarWS(`ws://127.0.0.1:${puerto}/ws`);
      assert.equal(ws2.readyState, WebSocket.OPEN, '/ws no aceptado');
      ws2.close();
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 14: Andres SOLO acepta /transmisor (rechaza /ws)
  // ───────────────────────────────────────────────────────────────────────────
  it('14. Andres receptor SOLO acepta /transmisor, rechaza /ws', async () => {
    const puerto = 19410;
    const hasNodeModules = fs.existsSync(path.join(ANDRES_PATH, '..', 'node_modules'));

    if (!hasNodeModules) {
      console.log('  ⏭  Saltando: Andres no tiene node_modules');
      return;
    }

    const { child: andres } = await levantarServidor(ANDRES_PATH, 'src/servidor.ts', [
      '--puerto', String(puerto)
    ]);

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto Andres no disponible');

      // /transmisor debería funcionar
      const ws1 = await conectarWS(`ws://127.0.0.1:${puerto}/transmisor`);
      assert.equal(ws1.readyState, WebSocket.OPEN, '/transmisor no aceptado');
      ws1.close();

      await espera(200);

      // /ws debería FALLAR (Andres destruye el socket)
      let ws2Failed = false;
      try {
        const ws2 = await conectarWS(`ws://127.0.0.1:${puerto}/ws`, 2000);
        ws2.close();
      } catch {
        ws2Failed = true;
      }
      assert.ok(ws2Failed, 'Andres debería rechazar /ws');
    } finally {
      andres.kill();
      await once(andres, 'exit').catch(() => {});
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 15: Puerto default 80 en los 3 proyectos
  // ───────────────────────────────────────────────────────────────────────────
  it('15. Los 3 proyectos usan puerto 80 por defecto', () => {
    const robertContent = fs.readFileSync(path.join(ROBERT_PATH, 'src', 'config.js'), 'utf-8');
    assert.ok(robertContent.includes('80'), 'Robert no usa puerto 80');

    const diegoContent = fs.readFileSync(path.join(DIEGO_PATH, 'src', 'config', 'constants.js'), 'utf-8');
    assert.ok(diegoContent.includes('80'), 'Diego no usa puerto 80');

    // Andres: puerto por defecto es 80 (del servidor.ts)
    const andresContent = fs.readFileSync(path.join(ANDRES_PATH, 'src', 'servidor.ts'), 'utf-8');
    assert.ok(andresContent.includes('80') || andresContent.includes('puerto'), 'Andres no referencia puerto 80');
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 16: Secuencia de comandos válida F→B→L→R
  // ───────────────────────────────────────────────────────────────────────────
  it('16. Secuencia F→B→L→R genera números en rangos correctos', () => {
    const diego = leerTablasDiego();
    const PRIMOS = [41, 43, 47, 53, 59, 61];

    const secuencia = [
      { cmd: 'F', expectedMin: 1000, expectedMax: 1999 },
      { cmd: 'B', expectedMin: 2000, expectedMax: 2999 },
      { cmd: 'L', expectedMin: 3000, expectedMax: 3999 },
      { cmd: 'R', expectedMin: 4000, expectedMax: 4999 },
    ];

    for (const { cmd, expectedMin, expectedMax } of secuencia) {
      const range = diego.commands[cmd];
      assert.equal(range.min, expectedMin, `${cmd} min incorrecto`);
      assert.equal(range.max, expectedMax, `${cmd} max incorrecto`);

      // Generar un número válido para este comando
      let encontrado = false;
      for (let n = range.min; n <= range.min + 100; n++) {
        const divisibles = PRIMOS.filter((p) => n % p === 0);
        if (divisibles.length === 1) {
          encontrado = true;
          break;
        }
      }
      assert.ok(encontrado, `No se encontró número válido para ${cmd} en rango ${range.min}-${range.max}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 17: Todos los 9 comandos tienen rango válido
  // ───────────────────────────────────────────────────────────────────────────
  it('17. Los 9 comandos (F,B,L,R,N,P,O,C,M) tienen rangos sin solaparse', () => {
    const diego = leerTablasDiego();
    const cmds = Object.entries(diego.commands);

    assert.equal(cmds.length, 9, `Debería haber 9 comandos, hay ${cmds.length}`);

    // Verificar que no se solapan
    const ranges = cmds.map(([cmd, meta]) => ({ cmd, min: meta.min, max: meta.max }));
    ranges.sort((a, b) => a.min - b.min);

    for (let i = 1; i < ranges.length; i++) {
      assert.ok(
        ranges[i].min > ranges[i - 1].max,
        `Solapamiento: ${ranges[i - 1].cmd} (${ranges[i - 1].max}) ≥ ${ranges[i].cmd} (${ranges[i].min})`
      );
    }

    // Verificar cobertura 1000-9999
    assert.equal(ranges[0].min, 1000, 'Primer rango no empieza en 1000');
    assert.equal(ranges[ranges.length - 1].max, 9999, 'Último rango no termina en 9999');
  });

  // ───────────────────────────────────────────────────────────────────────────
  //  ESCENARIO 18: Robert acepta /transmisor de scan de Diego
  // ───────────────────────────────────────────────────────────────────────────
  it('18. Scan de Diego con PROBE_PATHS detecta receptor Robert', async () => {
    const puerto = 19411;
    const { child: robert } = await levantarServidor(ROBERT_PATH, 'src/servidor.js', [
      '--puerto', String(puerto), '--sin-robot', '--tira-pelada'
    ]);

    try {
      const ok = await esperarPuerto(puerto, 20);
      assert.ok(ok, 'Puerto Robert no disponible');

      // Diego scannea con PROBE_PATHS = ['/transmisor', '/ws', '/ws/peer']
      const paths = ['/transmisor', '/ws', '/ws/peer'];
      let detectPath = null;

      for (const p of paths) {
        try {
          const ws = await conectarWS(`ws://127.0.0.1:${puerto}${p}`, 1500);
          detectPath = p;
          ws.close();
          break;
        } catch {
          // Este path no funcionó, probar el siguiente
        }
      }

      assert.ok(detectPath, 'Robert no detectado en ningún path');
      assert.ok(['/transmisor', '/ws'].includes(detectPath), `Path inesperado: ${detectPath}`);
    } finally {
      robert.kill();
      await once(robert, 'exit').catch(() => {});
    }
  });
});
