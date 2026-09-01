import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SIM_PORT = 18081;

function waitForMessage(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error('Timeout esperando mensaje del simulador'));
    }, timeoutMs);

    function onMessage(data) {
      clearTimeout(timer);
      ws.removeListener('message', onMessage);
      resolve(data.toString());
    }

    ws.on('message', onMessage);
  });
}

function connectClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${SIM_PORT}/ws`);
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
      reject(new Error('No se pudo conectar al simulador'));
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

let child;
let clientA;
let clientB;

before(async () => {
  child = spawn(process.execPath, [
    path.join(__dirname, '..', '..', 'simulador', 'esp32-simulator.js')
  ], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, SIM_PORT: String(SIM_PORT) },
    stdio: 'pipe'
  });

  const deadline = Date.now() + 5000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      clientA = await connectClient();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  throw lastError || new Error('Timeout esperando al simulador');
});

after(async () => {
  if (clientB) clientB.close();
  if (clientA) clientA.close();
  if (child) child.kill();
});

test('flujo de control y ACK contra el simulador real', async () => {
  assert.strictEqual(await waitForMessage(clientA), 'Control asignado a tu IP');

  clientA.send(JSON.stringify({ v: 1, cmd: 'F', ackId: 'abc-1' }));
  const ack = JSON.parse(await waitForMessage(clientA));
  assert.strictEqual(ack.v, 1);
  assert.strictEqual(ack.ack, true);
  assert.strictEqual(ack.cmd, 'F');
  assert.strictEqual(ack.ackId, 'abc-1');

  clientA.send('B');
  assert.strictEqual(await waitForMessage(clientA), 'ACK:B');

  clientB = await connectClient();
  assert.strictEqual(await waitForMessage(clientB), 'ERROR: Control ocupado');

  clientB.send('M');
  assert.strictEqual(await waitForMessage(clientB), 'C.E M');

  clientA.send('M');
  assert.strictEqual(await waitForMessage(clientA), 'Control liberado');
  assert.strictEqual(await waitForMessage(clientA), 'ACK:M');
});

test('MJPEG del simulador responde con multipart/x-mixed-replace', async () => {
  const mjpeg = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${SIM_PORT}/mjpeg`, (res) => {
      const result = { status: res.statusCode, contentType: res.headers['content-type'] };
      res.destroy();
      resolve(result);
    });
    req.on('error', reject);
  });

  assert.strictEqual(mjpeg.status, 200);
  assert.ok(mjpeg.contentType.startsWith('multipart/x-mixed-replace'));
});

test('simulador endpoints /status y /modo/ soportan cambio de modo de fallo', async () => {
  // Check default status
  const statusRes = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${SIM_PORT}/status`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  assert.strictEqual(statusRes.modo, 'normal');

  // Change mode to error
  const modoRes = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${SIM_PORT}/modo/error`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  assert.strictEqual(modoRes.ok, true);
  assert.strictEqual(modoRes.modo, 'error');

  // Restore mode to normal
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${SIM_PORT}/modo/normal`, (res) => {
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });
});