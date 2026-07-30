import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { TransmisorService } from '../src/services/transmisorService.js';
import { ReceptorService } from '../src/services/receptorService.js';

let httpServer, wss, port;
let transmisorService, receptorService;

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    const listeners = [];

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { msg = { raw: data.toString() }; }
      messages.push(msg);
      for (const fn of listeners) fn(msg);
    });

    ws._customOn = (fn) => listeners.push(fn);

    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));

    ws._getMessages = () => messages;
    ws._waitForMessage = (type, timeout = 3000) => {
      const existing = messages.find((m) => m.type === type);
      if (existing) return Promise.resolve(existing);

      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`Timeout esperando '${type}'`)), timeout);
        const listener = (msg) => {
          if (msg.type === type) {
            clearTimeout(timer);
            ws._customOn = null;
            res(msg);
          }
        };
        listeners.push(listener);
      });
    };
  });
}

describe('Conexión Transmisor → Receptor', () => {

  before(async () => {
    transmisorService = new TransmisorService();
    receptorService = new ReceptorService();

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      switch (url.pathname) {
        case '/ws/transmitter':
          transmisorService.handleConnection(ws, req);
          break;
        case '/ws/receiver':
          receptorService.handleReceiverConnection(ws, req);
          break;
        case '/ws/esp32':
          receptorService.handleESP32Connection(ws, req);
          break;
        default:
          ws.close(1008, 'Ruta no válida');
      }
    });

    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        port = httpServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (wss) await new Promise((r) => wss.close(r));
    if (httpServer) await new Promise((r) => httpServer.close(r));
  });

  it('el transmisor se conecta al backend y recibe CONNECTED', async () => {
    const ws = await connectWs(`ws://localhost:${port}/ws/transmitter`);

    try {
      const msg = await ws._waitForMessage('CONNECTED');
      assert.strictEqual(msg.type, 'CONNECTED');
      assert.ok(msg.message);
      assert.ok(msg.clientId);
    } finally {
      ws.close();
    }
  });

  it('el receptor se conecta al backend', async () => {
    const ws = await connectWs(`ws://localhost:${port}/ws/receiver`);

    try {
      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(ws.readyState, WebSocket.OPEN);
    } finally {
      ws.close();
    }
  });

  it('el transmisor envía un comando y recibe CONFIRMACION_COMANDO', async () => {
    const ws = await connectWs(`ws://localhost:${port}/ws/transmitter`);

    try {
      await ws._waitForMessage('CONNECTED');

      const ackId = crypto.randomUUID();
      const confirmPromise = ws._waitForMessage('CONFIRMACION_COMANDO');

      ws.send(JSON.stringify({
        type: 'COMMAND',
        command: 'W',
        commandName: 'Avanzar',
        step: 1,
        total: 1,
        ackId
      }));

      const msg = await confirmPromise;

      assert.strictEqual(msg.type, 'CONFIRMACION_COMANDO');
      assert.strictEqual(msg.command, 'W');
      assert.strictEqual(msg.commandName, 'Avanzar');
      assert.strictEqual(msg.step, 1);
      assert.strictEqual(msg.total, 1);
      assert.ok(typeof msg.encryptedNumber === 'number');
      assert.ok(['VALIDO', 'FALSO', 'CORRUPTO'].includes(msg.classification));
    } finally {
      ws.close();
    }
  });

  it('el receptor recibe AUDIT_LOG cuando se procesa un número', async () => {
    const rxWs = await connectWs(`ws://localhost:${port}/ws/receiver`);

    try {
      await new Promise((r) => setTimeout(r, 100));

      const auditPromise = rxWs._waitForMessage('AUDIT_LOG');

      rxWs.send(JSON.stringify({
        type: 'PROCESS_NUMBER',
        number: 1025,
        ackId: crypto.randomUUID()
      }));

      const msg = await auditPromise;

      assert.strictEqual(msg.type, 'AUDIT_LOG');
      assert.strictEqual(msg.number, 1025);
      assert.ok(['VALIDO', 'FALSO', 'CORRUPTO'].includes(msg.classification));
      assert.ok(msg.details);
    } finally {
      rxWs.close();
    }
  });

});
