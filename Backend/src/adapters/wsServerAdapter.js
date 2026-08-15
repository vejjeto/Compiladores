import { WebSocketServer, WebSocket } from 'ws';
import {
  buildEvent,
  buildResponse,
  buildPong,
  buildError,
  parseClientMessage
} from '../protocol/clientProtocol.js';
import { HANDLERS } from '../http/handlers.js';

const HEARTBEAT_MS = 30000;
const COMPONENT = 'WS-API';

export class WsServerAdapter {
  constructor({ server, ctx, logger }) {
    this.server = server;
    this.ctx = ctx;
    this.logger = logger;
    this.wss = null;
    this.heartbeat = null;
  }

  start() {
    this.wss = new WebSocketServer({ server: this.server, path: '/ws/api' });
    this.wss.on('connection', (ws) => this._handleConnection(ws));

    this.heartbeat = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
    this.heartbeat.unref();

    this.logger.info(COMPONENT, 'Servidor WebSocket listo en /ws/api');
  }

  _heartbeat() {
    if (!this.wss) return;

    for (const ws of this.wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  _handleConnection(ws) {
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      this._handleMessage(ws, data);
    });

    ws.on('close', () => {
      this.logger.info(COMPONENT, 'Cliente WebSocket desconectado');
    });

    ws.on('error', () => {
    });

    this.logger.info(COMPONENT, 'Cliente WebSocket conectado');
  }

  async _handleMessage(ws, data) {
    const msg = parseClientMessage(data.toString());

    if (msg === null) {
      ws.send(buildError({ requestId: null, message: 'Mensaje inválido' }));
      return;
    }

    if (msg.type === 'ping') {
      ws.send(buildPong());
      return;
    }

    if (msg.type !== 'request' || typeof msg.action !== 'string') {
      ws.send(buildError({ requestId: msg.requestId ?? null, message: 'Tipo de mensaje no soportado' }));
      return;
    }

    const handler = HANDLERS[msg.action];

    if (!handler) {
      ws.send(buildError({ requestId: msg.requestId ?? null, message: 'Acción desconocida: ' + msg.action }));
      return;
    }

    try {
      const result = await handler(this.ctx, msg.data ?? {});
      ws.send(buildResponse({
        requestId: msg.requestId,
        ok: result.ok,
        status: result.status,
        data: result.data,
        error: result.error ?? null
      }));
    } catch (err) {
      ws.send(buildResponse({
        requestId: msg.requestId,
        ok: false,
        status: 500,
        data: null,
        error: err.message
      }));
    }
  }

  broadcast(event, data) {
    if (!this.wss) return;

    const payload = buildEvent({ event, data });

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  stop() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}