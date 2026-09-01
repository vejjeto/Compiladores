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
    this.monitorConnections = new Set();
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

  _buildEstado() {
    return {
      tipo: 'estado',
      robot: this.ctx.carService.connected ? 'conectado' : 'desconectado',
      robotUrl: this.ctx.carService.address
        ? `ws://${this.ctx.carService.address}/ws`
        : 'ws://192.168.0.50/ws',
      transmisores: this.peerConnections.size,
      monitores: this.monitorConnections.size,
      direcciones: this._getTransmitterAddresses()
    };
  }

  _getTransmitterAddresses() {
    const ifaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(`ws://${iface.address}/transmisor`);
        }
      }
    }
    return addresses.length > 0 ? addresses : ['ws://127.0.0.1/transmisor'];
  }

  _handleMonitorConnection(ws) {
    this.monitorConnections.add(ws);
    this.logger.info(COMPONENT, 'Monitor conectado');

    // Send current state immediately
    ws.send(JSON.stringify(this._buildEstado()));

    ws.on('close', () => {
      this.monitorConnections.delete(ws);
      this.logger.info(COMPONENT, 'Monitor desconectado');
    });

    ws.on('error', () => {
      this.monitorConnections.delete(ws);
    });
  }

  broadcastMonitor(data) {
    if (this.monitorConnections.size === 0) return;
    const json = JSON.stringify(data);
    for (const monitor of this.monitorConnections) {
      if (monitor.readyState === monitor.OPEN) {
        monitor.send(json);
      }
    }
  }

  start() {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws) => this._handleConnection(ws));

    this.peerWss = new WebSocketServer({ noServer: true });
    this.peerWss.on('connection', (ws) => this._handlePeerConnection(ws));

    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/ws' || url.pathname === '/ws/peer' || url.pathname === '/transmisor') {
        this.peerWss.handleUpgrade(req, socket, head, (ws) => {
          this.peerWss.emit('connection', ws, req);
        });
      } else if (url.pathname === '/monitor') {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this._handleMonitorConnection(ws);
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

    this.logger.info(COMPONENT, 'Servidor WebSocket API listo en /ws/api');
    this.logger.info(COMPONENT, 'Servidor WebSocket Receptor listo en /ws (y compatible con /transmisor y /ws/peer)');
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

    // Also broadcast to monitors as log entries
    this.broadcastMonitor({ tono: 'info', texto: `[${event}] ${JSON.stringify(data)}`, hora: new Date().toISOString() });
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
    const rawIp = ws._socket?.remoteAddress || 'desconocida';
    const clientIp = rawIp.replace(/^::ffff:/, '');
    this.logger.info(COMPONENT, `Transmisor conectado desde ${clientIp}`);
    this.peerConnections.add(ws);

    this.ctx.auditService.broadcast('TRANSMITTER_CONNECTED', {
      ip: clientIp,
      timestamp: new Date().toISOString()
    });

    // Notify monitors about new transmitter count
    this.broadcastMonitor(this._buildEstado());

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
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'command-result', ok: false, status: 409, data: { error: 'Carro no conectado en el receptor' } }));
          }
          return;
        }

        const result = this.ctx.transmisorService.executeCommand(msg.command);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'command-result',
            ok: result.ok,
            status: result.status,
            data: result
          }));
        }
        return;
      }

      if (msg.type === 'program') {
        this.logger.info(COMPONENT, `Programa remoto del peer recibido`);
        if (!this.ctx.carService.connected) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'program-result', ok: false, status: 409, data: { error: 'Carro no conectado en el receptor' } }));
          }
          return;
        }
        const result = this.ctx.transmisorService.executeProgram(msg.program);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'program-result', ok: result.ok, status: result.status, data: result }));
        }
        return;
      }

      if (msg.type === 'programa-numeros') {
        this.logger.info(COMPONENT, `Programa de números remoto del peer recibido`);
        if (!this.ctx.carService.connected) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              estado: 'ERROR',
              motivo: 'Robot desconectado'
            }));
          }
          return;
        }
        const result = this.ctx.transmisorService.executeEncodedProgram(msg.programa);
        if (ws.readyState === WebSocket.OPEN) {
          // GitLab-compatible direct response format
          ws.send(JSON.stringify({
            estado: result.ok ? 'OK' : 'ERROR',
            comando: result.program || '',
            motivo: result.error || undefined,
            timestamp: new Date().toISOString()
          }));
        }
        return;
      }

      if (msg.type === 'raw') {
        this.logger.info(COMPONENT, `Carácter crudo remoto del peer recibido: '${msg.char}'`);
        if (!this.ctx.carService.connected) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'raw-result', ok: false, status: 409, data: { error: 'Carro no conectado en el receptor' } }));
          }
          return;
        }
        const result = this.ctx.transmisorService.sendRawChar(msg.char);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'raw-result', ok: result.ok, status: result.status, data: result }));
        }
        return;
      }
    });

    ws.on('close', () => {
      this.peerConnections.delete(ws);
      this.ctx.carService.removeListener('message', onCarMessage);
      unsubAudit();
      this.logger.info(COMPONENT, `Transmisor desconectado: ${clientIp}`);

      this.ctx.auditService.broadcast('TRANSMITTER_DISCONNECTED', {
        ip: clientIp,
        timestamp: new Date().toISOString()
      });

      // Notify monitors about transmitter count change
      this.broadcastMonitor(this._buildEstado());
    });

    ws.on('error', () => {
      this.peerConnections.delete(ws);
      this.ctx.carService.removeListener('message', onCarMessage);
      unsubAudit();
    });
  }
}