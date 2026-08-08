import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import logger from '../utils/logger.js';

const COMPONENT = 'CARRO';
const CONNECT_TIMEOUT = 5000;
const ACK_TIMEOUT = 5000;

export class CarService extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.ip = null;
    this.port = null;
    this.pendingAcks = new Map();
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
      logger.info(COMPONENT, `Conectando al carro en ${url}`);

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
        logger.success(COMPONENT, `Carro conectado en ${url}`);
        this.emitStatus('connected');
        resolve({ ok: true, status: 'connected', ip, port });
      });

      ws.on('message', (data) => {
        const message = data.toString();
        logger.info(COMPONENT, `Mensaje del carro: ${message}`);
        this.emit('message', message);

        if (message.startsWith('ACK:')) {
          const key = message.slice(4);
          const waiter = this.pendingAcks.get(key);
          if (waiter) {
            this.pendingAcks.delete(key);
            clearTimeout(waiter.timer);
            waiter.resolve(true);
          }
        }
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        if (this.ws === ws) {
          this.ws = null;
          logger.warn(COMPONENT, 'Carro desconectado');
          this.emitStatus('disconnected');
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        logger.error(COMPONENT, 'Error con el carro', { error: err.message });
        if (!settled) {
          settled = true;
          this.emitStatus('error');
          reject(err);
        }
      });
    });
  }

  disconnect() {
    for (const [key, waiter] of [...this.pendingAcks.entries()]) {
      clearTimeout(waiter.timer);
      waiter.resolve(false);
      this.pendingAcks.delete(key);
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { }
      logger.warn(COMPONENT, 'Desconectando carro');
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

    if (this.pendingAcks.has(char)) {
      this.pendingAcks.delete(char);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingAcks.has(char)) {
          this.pendingAcks.delete(char);
          logger.warn(COMPONENT, `Timeout esperando ACK para '${char}' (${timeout}ms)`);
          resolve(false);
        }
      }, timeout);

      this.pendingAcks.set(char, {
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
        if (this.pendingAcks.has(char)) this.pendingAcks.delete(char);
        logger.error(COMPONENT, `Error enviando '${char}' al carro`, { error: err.message });
        resolve(false);
      }
    });
  }

  emitStatus(status) {
    this.emit('status', { status, ip: this.ip, port: this.port });
  }
}
