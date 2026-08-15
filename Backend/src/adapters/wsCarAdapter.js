import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import { CarPort } from '../ports/carPort.js';
import { buildCommand, parseMessage } from '../protocol/commands.js';

const COMPONENT = 'CARRO';
const CONNECT_TIMEOUT = 5000;
const ACK_TIMEOUT = 5000;

const VALID_DIALECTS = new Set(['legacy', 'json']);

export class WsCarAdapter extends CarPort {
  constructor({ dialect = 'legacy' } = {}) {
    super();
    this._validateDialect(dialect);
    this.dialect = dialect;
    this.ws = null;
    this.ip = null;
    this.port = null;
    this.pendingAcks = new Map();
  }

  _validateDialect(dialect) {
    if (!VALID_DIALECTS.has(dialect)) {
      throw new TypeError(`WsCarAdapter: unknown dialect '${dialect}' (expected 'legacy' or 'json')`);
    }
  }

  setDialect(dialect) {
    this._validateDialect(dialect);
    this.dialect = dialect;
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
        this._handleIncoming(message);
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

  sendCommand(command) {
    if (!this.connected) {
      throw new Error('No hay conexión con el carro');
    }
    if (this.dialect === 'json') {
      this.ws.send(buildCommand({ cmd: command, params: {}, ackId: uuidv4() }));
      return;
    }
    this.ws.send(command);
  }

  sendCommandJson({ cmd, params = {}, ackId } = {}) {
    if (!this.connected) {
      throw new Error('No hay conexión con el carro');
    }
    const id = ackId ?? uuidv4();
    this.ws.send(buildCommand({ cmd, params, ackId: id }));
    return id;
  }

  waitForAck(key, timeout = ACK_TIMEOUT) {
    if (!this.connected) {
      return Promise.resolve(false);
    }

    if (this.pendingAcks.has(key)) {
      this.pendingAcks.delete(key);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingAcks.has(key)) {
          this.pendingAcks.delete(key);
          logger.warn(COMPONENT, `Timeout esperando ACK para '${key}' (${timeout}ms)`);
          resolve(false);
        }
      }, timeout);

      this.pendingAcks.set(key, {
        timer,
        resolve: (ok) => {
          clearTimeout(timer);
          resolve(ok);
        }
      });

      if (this.dialect === 'json') {
        return;
      }

      try {
        this.ws.send(key);
      } catch (err) {
        clearTimeout(timer);
        if (this.pendingAcks.has(key)) this.pendingAcks.delete(key);
        logger.error(COMPONENT, `Error enviando '${key}' al carro`, { error: err.message });
        resolve(false);
      }
    });
  }

  _handleIncoming(message) {
    const parsed = parseMessage(message);

    switch (parsed.kind) {
      case 'legacy':
        this._resolvePending(parsed.data.cmd);
        break;
      case 'json':
        this._resolvePending(parsed.data.ackId);
        break;
      case 'json-invalid':
        logger.warn(COMPONENT, `JSON del carro inválido: ${message}`);
        break;
      default:
        logger.warn(COMPONENT, `Mensaje del carro no reconocido: ${message}`);
    }
  }

  _resolvePending(key) {
    const waiter = this.pendingAcks.get(key);
    if (waiter) {
      this.pendingAcks.delete(key);
      clearTimeout(waiter.timer);
      waiter.resolve(true);
    }
  }

  emitStatus(status) {
    this.emit('status', { status, ip: this.ip, port: this.port });
  }
}