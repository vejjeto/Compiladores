import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { info, warn, error, success } from '../utils/logger.js';

const COMPONENT = 'CARRO';
const CONNECT_TIMEOUT = 5000;
const ACK_TIMEOUT = 5000;
const pendingAcks = new Map();

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

        if (message.startsWith('ACK:')) {
          const key = message.slice(4);
          const waiter = pendingAcks.get(key);
          if (waiter) {
            pendingAcks.delete(key);
            clearTimeout(waiter.timer);
            waiter.resolve(true);
          }
        }
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
    for (const key of [...pendingAcks.keys()]) {
      pendingAcks.delete(key);
    }
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

  waitForAck(char, timeout = ACK_TIMEOUT) {
    if (!this.connected) {
      return Promise.resolve(false);
    }

    if (pendingAcks.has(char)) {
      pendingAcks.delete(char);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pendingAcks.has(char)) {
          pendingAcks.delete(char);
          warn(COMPONENT, `Timeout esperando ACK para '${char}' (${timeout}ms)`);
          resolve(false);
        }
      }, timeout);

      pendingAcks.set(char, {
        timer,
        resolve: (ok) => {
          clearTimeout(timer);
          resolve(ok);
        }
      });

      try {
        this.ws.send(char);
      } catch (err) {
        clearTimeout(timer);
        if (pendingAcks.has(char)) pendingAcks.delete(char);
        error(COMPONENT, `Error enviando '${char}' al carro`, { error: err.message });
        resolve(false);
      }
    });
  }

  emitStatus(status) {
    this.emit('status', { status, ip: this.ip, port: this.port });
  }
}
