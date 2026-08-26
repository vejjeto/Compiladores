import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import {
  buildEvent,
  buildResponse,
  buildPong,
  buildError,
  parseClientMessage
} from '../protocol/clientProtocol.js';
import { HANDLERS } from '../http/handlers.js';

const HEARTBEAT_MS = 30000;
const DEFAULT_CAR_IP = '192.168.0.50';
const DEFAULT_CAR_PORT = 80;
const COMPONENT = 'WS-API';

export class WsServerAdapter {
  constructor({ server, ctx, logger }) {
    this.server = server;
    this.ctx = ctx;
    this.logger = logger;
    this.wss = null;
    this.peerWss = null;
    this.heartbeat = null;
    this.localIp = this._detectLocalIp();
    this.peerConnections = new Set();
  }

  _detectLocalIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  start() {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws) => this._handleConnection(ws));

    this.peerWss = new WebSocketServer({ noServer: true });
    this.peerWss.on('connection', (ws) => this._handlePeerConnection(ws));

    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/ws/peer') {
        this.peerWss.handleUpgrade(req, socket, head, (ws) => {
          this.peerWss.emit('connection', ws, req);
        });
      } else if (url.pathname === '/ws/api') {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    this.heartbeat = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
    this.heartbeat.unref();

    this.logger.info(COMPONENT, 'Servidor WebSocket listo en /ws/api');
    this.logger.info(COMPONENT, 'Servidor Peer WebSocket listo en /ws/peer');
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

    // Enviar IP del PC al frontend al conectar
    ws.send(buildEvent({
      event: 'CAR_MESSAGE',
      data: { message: `PC_IP:${this.localIp}`, timestamp: new Date().toISOString() }
    }));

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
    if (this.peerWss) {
      this.peerWss.close();
      this.peerWss = null;
    }
    for (const peer of this.peerConnections) {
      try { peer.close(); } catch {}
    }
    this.peerConnections.clear();
  }

  _handlePeerConnection(ws) {
    const clientIp = ws._socket?.remoteAddress || 'desconocida';
    this.logger.info(COMPONENT, `Peer conectado desde ${clientIp}`);
    this.peerConnections.add(ws);

    // Forward car events to this peer
    const unsubAudit = this.ctx.auditService.subscribe(({ type, data }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'event', event: type, data }));
      }
    });

    // Forward car messages to this peer
    const onCarMessage = (message) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'car-message', message }));
      }
    };
    this.ctx.carService.on('message', onCarMessage);

    ws.on('message', async (raw) => {
      let msg;
      try { 
        msg = JSON.parse(raw.toString()); 
      } catch { 
        // Fallback por si llega texto crudo no-JSON
        const dataStr = raw.toString();
        if (/^\d+$/.test(dataStr)) {
          msg = { type: 'programa-numeros', programa: dataStr };
        } else {
          return; 
        }
      }

      // Modo Compatibilidad GitLab (Receptor): 
      if (typeof msg === 'number' || (typeof msg === 'string' && /^\d+$/.test(msg))) {
        msg = { type: 'programa-numeros', programa: String(msg) };
      }

      if (msg.type === 'connect-car') {
        // Transmitter asks receiver to connect to the car
        const carIp = msg.ip || DEFAULT_CAR_IP;
        const carPort = msg.port || DEFAULT_CAR_PORT;
        this.logger.info(COMPONENT, `Peer pide conectar al carro: ${carIp}:${carPort}`);

        if (this.ctx.carService.connected) {
          ws.send(JSON.stringify({ type: 'connect-car-result', ok: true, message: 'Carro ya conectado' }));
          return;
        }

        try {
          await this.ctx.carService.connect(carIp, carPort);
          ws.send(JSON.stringify({ type: 'connect-car-result', ok: true, message: `Carro conectado en ${carIp}:${carPort}` }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'connect-car-result', ok: false, error: err.message }));
        }
        return;
      }

      if (msg.type === 'command') {
        // Remote peer sends a command → execute locally against car
        this.logger.info(COMPONENT, `Comando remoto del peer: '${msg.command}'`);

        if (!this.ctx.carService.connected) {
          ws.send(JSON.stringify({ type: 'command-result', ok: false, status: 409, data: { error: 'Carro no conectado en el receptor' } }));
          return;
        }

        const result = this.ctx.transmisorService.executeCommand(msg.command);
        ws.send(JSON.stringify({
          type: 'command-result',
          ok: result.ok,
          status: result.status,
          data: result
        }));
      }
    });

    ws.on('close', () => {
      this.peerConnections.delete(ws);
      this.ctx.carService.removeListener('message', onCarMessage);
      unsubAudit();
      this.logger.info(COMPONENT, `Peer desconectado: ${clientIp}`);
    });

    ws.on('error', () => {
      this.peerConnections.delete(ws);
      this.ctx.carService.removeListener('message', onCarMessage);
      unsubAudit();
    });
  }
}