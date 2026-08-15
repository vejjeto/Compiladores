import { EventEmitter } from 'events';

/**
 * Event names emitted by a CarPort implementation.
 * @constant {Object<string, string>}
 */
export const CAR_PORT_EVENTS = Object.freeze({
  STATUS: 'status',
  MESSAGE: 'message'
});

/**
 * @typedef {Object} CarPortContract
 * @description Contract that every car transport adapter must satisfy.
 * @property {() => boolean} connected - Whether the transport is open and usable.
 * @property {() => string|null} address - Current remote address (`ip:port`) or null.
 * @property {(ip: string, port?: number) => Promise<{ok: boolean, status: string, ip: string, port: number}>} connect
 *   Opens a connection to the car. Resolves on success or failure.
 * @property {() => void} disconnect - Closes the connection and settles all pending acks as false.
 * @property {(command: string) => void} sendCommand - Sends a command to the car. Throws when disconnected.
 * @property {(command: string, timeout?: number) => Promise<boolean>} waitForAck
 *   Waits for the ack of the given command token (a command char or an ackId) within `timeout` ms.
 *   Resolves true on ack, false on timeout/disconnect.
 * @property {'status'} events.status - Emits `{status: 'connected'|'disconnected'|'error', ip, port}`.
 * @property {'message'} events.message - Emits the raw payload string received from the car.
 */

/**
 * Base class marking the CarPort contract.
 *
 * This class is the interface marker: it must never be instantiated directly.
 * Concrete transports (e.g. WsCarAdapter) extend it and override every member.
 *
 * @abstract
 * @extends EventEmitter
 */
export class CarPort extends EventEmitter {
  /**
   * Whether the transport is open and usable.
   * @returns {boolean}
   */
  get connected() {
    throw new Error('CarPort: not implemented by base class');
  }

  /**
   * Current remote address (`ip:port`) or null when disconnected.
   * @returns {string|null}
   */
  get address() {
    throw new Error('CarPort: not implemented by base class');
  }

  /**
   * Opens a connection to the car.
   * @param {string} ip - Car IP or hostname.
   * @param {number} [port=80] - Car port.
   * @returns {Promise<{ok: boolean, status: string, ip: string, port: number}>}
   */
  connect(ip, port = 80) {
    throw new Error('CarPort: not implemented by base class');
  }

  /**
   * Closes the connection and settles all pending acks as false.
   * @returns {void}
   */
  disconnect() {
    throw new Error('CarPort: not implemented by base class');
  }

  /**
   * Sends a command to the car. Throws when disconnected.
   * @param {string} command - Command token (a command char in legacy dialect, or a command char in json dialect).
   * @returns {void}
   */
  sendCommand(command) {
    throw new Error('CarPort: not implemented by base class');
  }

  /**
   * Waits for the ack of the given command token within `timeout` ms.
   * Resolves true on ack, false on timeout or disconnect.
   * @param {string} command - Command token: a command char (legacy) or an ackId (json).
   * @param {number} [timeout=5000] - Timeout in milliseconds.
   * @returns {Promise<boolean>}
   */
  waitForAck(command, timeout = 5000) {
    throw new Error('CarPort: not implemented by base class');
  }
}