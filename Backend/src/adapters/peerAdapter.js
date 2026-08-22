import { WebSocket } from 'ws';
import logger from '../utils/logger.js';

const COMPONENT = 'PEER';
const CONNECT_TIMEOUT = 5000;

export class PeerAdapter {
  constructor({ ctx }) {
    this.ctx = ctx;
    this.ws = null;
    this.ip = null;
    this.port = null;
    this.role = null; // 'transmitter' or 'receiver'
    this.listeners = new Set();
  }

  get connected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get address() {
    return this.ip ? `${this.ip}:${this.port}` : null;
  }

  connect(url, role = 'transmitter') {
    if (this.connected) {
      this.disconnect();
    }

    this.role = role;

    return new Promise((resolve, reject) => {
      logger.info(COMPONENT, `Conectando peer en ${url} (rol: ${role})`);

      const ws = new WebSocket(url);
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.terminate();
          reject(new Error('Timeout conectando al peer'));
        }
      }, CONNECT_TIMEOUT);

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.ws = ws;

        const urlObj = new URL(url);
        this.ip = urlObj.hostname;
        this.port = urlObj.port;

        logger.success(COMPONENT, `Peer conectado en ${url} (rol: ${role})`);
        this._notifyListeners({ type: 'peer-connected', role, address: this.address });
        resolve({ ok: true, status: 'connected', role, address: this.address });
      });

      ws.on('message', (data) => {
        this._handleMessage(data.toString());
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        if (this.ws === ws) {
          this.ws = null;
          this.ip = null;
          this.port = null;
          logger.warn(COMPONENT, 'Peer desconectado');
          this._notifyListeners({ type: 'peer-disconnected' });
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        logger.error(COMPONENT, 'Error con el peer', { error: err.message });
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  disconnect() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch {}
      this.ip = null;
      this.port = null;
      this.role = null;
      logger.warn(COMPONENT, 'Desconectando peer');
      this._notifyListeners({ type: 'peer-disconnected' });
    }
  }

  sendCommand(command) {
    if (!this.connected) {
      throw new Error('No hay conexión con el peer');
    }
    this.ws.send(JSON.stringify({ type: 'command', command }));
  }

  sendEvent(event, data) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ type: 'event', event, data }));
  }

  sendCarMessage(message) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ type: 'car-message', message }));
  }

  sendCarStatus(status) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ type: 'car-status', status }));
  }

  onMessage(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _notifyListeners(msg) {
    for (const cb of this.listeners) {
      try { cb(msg); } catch {}
    }
  }

  async _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'command':
        // Peer sends a command → execute against local car
        this._handleRemoteCommand(msg.command);
        break;
      case 'event':
        // Peer sends an event → forward to local listeners
        this._notifyListeners({ type: 'peer-event', event: msg.event, data: msg.data });
        break;
      case 'car-message':
        // Peer forwards car message → forward to local listeners
        this._notifyListeners({ type: 'peer-car-message', message: msg.message });
        break;
      case 'car-status':
        // Peer forwards car status → forward to local listeners
        this._notifyListeners({ type: 'peer-car-status', status: msg.status });
        break;
    }
  }

  async _handleRemoteCommand(command) {
    const { carService, transmisorService, auditService } = this.ctx;

    if (!carService.connected) {
      logger.warn(COMPONENT, `Comando remoto '${command}' rechazado: carro no conectado`);
      this.sendEvent('COMMAND_ERROR', { command, error: 'Carro no conectado en el receptor' });
      return;
    }

    logger.info(COMPONENT, `Ejecutando comando remoto '${command}'`);

    const result = transmisorService.executeCommand(command);

    if (result.ok) {
      // Forward sequence events back to the peer
      const origBroadcast = auditService.broadcast.bind(auditService);
      auditService.broadcast = (type, data) => {
        origBroadcast(type, data);
        this.sendEvent(type, data);
      };

      // Restore after sequence completes
      setTimeout(() => {
        auditService.broadcast = origBroadcast;
      }, 30000);

      this.sendEvent('COMMAND_ACCEPTED', { command, sequenceId: result.sequenceId });
    } else {
      this.sendEvent('COMMAND_ERROR', { command, error: result.error });
    }
  }
}
