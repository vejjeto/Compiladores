import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import { CarPort } from '../ports/carPort.js';
import { buildCommand, parseMessage } from '../protocol/commands.js';

const COMPONENT = 'CARRO';
const CONNECT_TIMEOUT = 5000;
const ACK_TIMEOUT = 5000;

const VALID_DIALECTS = new Set(['legacy', 'json']);

/**
 * WebSocket transport for the robotic car, implementing the CarPort contract.
 *
 * Supports two dialects:
 * - `legacy` (default): sends raw command chars, receives raw `ACK:<char>`.
 * - `json`: sends versioned JSON v1 commands, receives JSON v1 acks.
 *
 * Inbound messages are always auto-detected between both dialects, so an
 * existing firmware/simulator keeps working and a JSON-speaking car connects
 * seamlessly.
 *
 * @extends CarPort
 */
export class WsCarAdapter extends CarPort {
  /**
   * @param {Object} [opts] - Adapter options.
   * @param {string} [opts.dialect='legacy'] - Sending dialect: 'legacy' or 'json'.
   * @throws {TypeError} When `dialect` is not valid.
   */
  constructor({ dialect = 'legacy' } = {}) {
    super();
    this._validateDialect(dialect);
    this.dialect = dialect;
    this.ws = null;
    this.ip = null;
    this.port = null;
    this.pendingAcks = new Map();
  }

  /**
   * Validates a dialect name.
   * @param {string} dialect - Dialect to validate.
   * @throws {TypeError} When the dialect is unknown.
   * @private
   */
  _validateDialect(dialect) {
    if (!VALID_DIALECTS.has(dialect)) {
      throw new TypeError(`WsCarAdapter: unknown dialect '${dialect}' (expected 'legacy' or 'json')`);
    }
  }

  /**
   * Changes the sending dialect at runtime.
   * @param {string} dialect - New dialect: 'legacy' or 'json'.
   * @throws {TypeError} When the dialect is unknown.
   * @returns {void}
   */
  setDialect(dialect) {
    this._validateDialect(dialect);
    this.dialect = dialect;
  }

  /**
   * Whether the WebSocket to the car is open.
   * @returns {boolean}
   */
  get connected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Current car address (`ip:port`) or null when disconnected.
   * @returns {string|null}
   */
  get address() {
    return this.ip ? `${this.ip}:${this.port}` : null;
  }

  /**
   * Opens the WebSocket connection to the car.
   *
   * Short-circuits with `{ok:true,status:'connected'}` when already connected
   * to the same ip/port. Times out after CONNECT_TIMEOUT ms.
   *
   * @param {string} ip - Car IP or hostname.
   * @param {number} [port=80] - Car port.
   * @returns {Promise<{ok: boolean, status: string, ip: string, port: number}>}
   */
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

  /**
   * Closes the connection and settles every pending ack as false.
   * @returns {void}
   */
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

  /**
   * Sends a command using the configured dialect.
   *
   * - legacy: sends the raw command char (exactly the historical behavior).
   * - json: builds a JSON v1 command with a fresh ackId.
   *
   * Throws when disconnected. For json mode, use `sendCommandJson` when you
   * need the ackId back to `waitForAck(ackId)`.
   *
   * @param {string} command - Command char (e.g. 'F').
   * @returns {void}
   * @throws {Error} When not connected.
   * @throws {TypeError} When the command is unknown (json dialect only).
   */
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

  /**
   * Sends a JSON v1 command and returns its ackId for correlation.
   *
   * Useful in json dialect so callers can `waitForAck(ackId)`.
   *
   * @param {Object} [opts] - Command options.
   * @param {string} opts.cmd - Command char (e.g. 'F').
   * @param {Object} [opts.params={}] - Optional parameters payload.
   * @param {string} [opts.ackId] - Optional explicit ackId; generated when omitted.
   * @returns {string} The ackId associated with the sent command.
   * @throws {Error} When not connected.
   * @throws {TypeError} When the command is unknown.
   */
  sendCommandJson({ cmd, params = {}, ackId } = {}) {
    if (!this.connected) {
      throw new Error('No hay conexión con el carro');
    }
    const id = ackId ?? uuidv4();
    this.ws.send(buildCommand({ cmd, params, ackId: id }));
    return id;
  }

  /**
   * Waits for the ack of the given command token within `timeout` ms.
   *
   * Semantics are identical across dialects: a pending waiter keyed by the
   * token, resolved true on ack, false on timeout or disconnect.
   *
   * - legacy: the token is the command char and it is SENT first (historical
   *   behavior, `waitForAck('F')` sends 'F' and waits for `ACK:F`).
   * - json: the token is an ackId returned by `sendCommandJson`, so nothing is
   *   sent here; callers send first and then wait by ackId.
   *
   * @param {string} key - Command char (legacy) or ackId (json).
   * @param {number} [timeout=ACK_TIMEOUT] - Timeout in milliseconds.
   * @returns {Promise<boolean>}
   */
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

  /**
   * Routes an inbound message to the pending ack waiters.
   *
   * Both dialects are auto-detected: legacy acks resolve by command char, json
   * acks resolve by ackId. Invalid or unknown payloads only log a warning.
   *
   * @param {string} message - Raw payload string from the car.
   * @private
   */
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

  /**
   * Resolves and removes the pending waiter keyed by `key` when present.
   * @param {string} key - Pending token (command char or ackId).
   * @private
   */
  _resolvePending(key) {
    const waiter = this.pendingAcks.get(key);
    if (waiter) {
      this.pendingAcks.delete(key);
      clearTimeout(waiter.timer);
      waiter.resolve(true);
    }
  }

  /**
   * Emits the `'status'` event with the current connection state.
   * @param {'connected'|'disconnected'|'error'} status - New status.
   * @returns {void}
   */
  emitStatus(status) {
    this.emit('status', { status, ip: this.ip, port: this.port });
  }
}