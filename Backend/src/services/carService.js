import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { info, warn, error, success } from '../utils/logger.js';

const COMPONENT = 'CARRO';
const CONNECT_TIMEOUT = 5000;

export class CarService extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.ip = null;
    this.port = null;
  }

  get connected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get address() {
    return this.ip ? `${this.ip}:${this.port}` : null;
  }

  connect(ip, port = 80) {
    const url = `ws://${ip}:${port}/ws`;

    if (this.connected && this.ip === ip && Number(this.port) === Number(port)) {
      return Promise.resolve({ ok: true, status: 'connected', ip, port });
    }

    this.disconnect();

    return new Promise((resolve, reject) => {
      info(COMPONENT, `Conectando al carro en ${url}`);

      const ws = new WebSocket(url);
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.terminate();
          this.emitStatus('error');
          reject(new Error('Timeout conectando al carro'));
        }
      }, CONNECT_TIMEOUT);

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.ws = ws;
        this.ip = ip;
        this.port = Number(port);
        success(COMPONENT, `Carro conectado en ${url}`);
        this.emitStatus('connected');
        resolve({ ok: true, status: 'connected', ip, port });
      });

      ws.on('message', (data) => {
        const message = data.toString();
        info(COMPONENT, `Mensaje del carro: ${message}`);
        this.emit('message', message);
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        if (this.ws === ws) {
          this.ws = null;
          warn(COMPONENT, 'Carro desconectado');
          this.emitStatus('disconnected');
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        error(COMPONENT, 'Error con el carro', { error: err.message });
        if (!settled) {
          settled = true;
          this.emitStatus('error');
          reject(err);
        }
      });
    });
  }

  disconnect() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { }
      warn(COMPONENT, 'Desconectando carro');
      this.emitStatus('disconnected');
    }
    this.ip = null;
    this.port = null;
  }

  sendCommand(char) {
    if (!this.connected) {
      throw new Error('No hay conexión con el carro');
    }
    this.ws.send(char);
  }

  emitStatus(status) {
    this.emit('status', { status, ip: this.ip, port: this.port });
  }
}
