import { COMMAND_MAP } from '../core/parser.js';

/**
 * Current version of the JSON car protocol.
 * @constant {number}
 */
export const PROTOCOL_VERSION = 1;

/**
 * Canonical semantic name for each command char, used to expose a
 * transport-agnostic vocabulary to other projects.
 * @constant {Object<string, string>}
 */
const STANDARD_NAMES = {
  F: 'move.forward',
  B: 'move.backward',
  R: 'turn.right',
  L: 'turn.left',
  O: 'gripper.open',
  C: 'gripper.close',
  N: 'camera.on',
  P: 'camera.off',
  M: 'control.release'
};

/**
 * Vocabulary derived from the single source of truth (COMMAND_MAP).
 * Maps each command char to its ESP32 char, display name, type and a
 * standard semantic name suitable for cross-project integration.
 * @constant {Object<string, {char: string, name: string, type: string, standard: string}>}
 */
export const VOCABULARY = Object.fromEntries(
  Object.entries(COMMAND_MAP).map(([char, meta]) => [
    char,
    {
      char: meta.esp32,
      name: meta.name,
      type: meta.type,
      standard: STANDARD_NAMES[char]
    }
  ])
);

/**
 * Builds a JSON v1 command message as a string.
 *
 * @param {Object} opts - Command options.
 * @param {string} opts.cmd - Command char, must exist in COMMAND_MAP.
 * @param {Object} [opts.params={}] - Optional parameters payload.
 * @param {string} [opts.ackId] - Correlation id echoed back in the ack.
 * @returns {string} JSON string like `{"v":1,"cmd":"F","params":{},"ackId":"..."}`.
 * @throws {TypeError} When `cmd` is not a known command.
 */
export function buildCommand({ cmd, params = {}, ackId } = {}) {
  if (!COMMAND_MAP[cmd]) {
    throw new TypeError(`buildCommand: unknown command '${cmd}'`);
  }
  return JSON.stringify({ v: PROTOCOL_VERSION, cmd, params, ackId });
}

/**
 * Builds a JSON v1 ack message as a string.
 *
 * @param {Object} opts - Ack options.
 * @param {string} opts.cmd - Command char being acknowledged.
 * @param {string} [opts.status='done'] - Execution status of the command.
 * @param {string} [opts.ackId] - Correlation id echoed from the command.
 * @returns {string} JSON string like `{"v":1,"ack":true,"cmd":"F","status":"done","ackId":"..."}`.
 */
export function buildAck({ cmd, status = 'done', ackId } = {}) {
  return JSON.stringify({ v: PROTOCOL_VERSION, ack: true, cmd, status, ackId });
}

/**
 * Parses an inbound car payload, auto-detecting the dialect.
 *
 * - JSON object payload: validated against v1/ack/cmd shape.
 * - Legacy `ACK:<char>` raw string.
 * - Anything else: unknown.
 *
 * Never throws.
 *
 * @param {string} payload - Raw payload received from the car.
 * @returns {{kind: 'json'|'legacy'|'json-invalid'|'unknown', data: Object|null}} Parsed result.
 */
export function parseMessage(payload) {
  if (typeof payload !== 'string') {
    return { kind: 'unknown', data: null };
  }

  if (payload.startsWith('{')) {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && parsed.v === PROTOCOL_VERSION && parsed.ack === true && typeof parsed.cmd === 'string') {
        return {
          kind: 'json',
          data: { ack: true, cmd: parsed.cmd, status: parsed.status, ackId: parsed.ackId }
        };
      }
      return { kind: 'json-invalid', data: null };
    } catch {
      return { kind: 'json-invalid', data: null };
    }
  }

  if (payload.startsWith('ACK:')) {
    return { kind: 'legacy', data: { ack: true, cmd: payload.slice(4) } };
  }

  return { kind: 'unknown', data: null };
}

/**
 * Checks whether a parsed message acknowledges the given pending token.
 *
 * IMPORTANT SIMPLICITY RULE: the pending token keyed by `waitForAck(key)` is
 * the SENT command token. In legacy mode the token IS the command char (e.g.
 * `'F'`), so legacy acks match by `data.cmd`. In json mode the token IS the
 * `ackId` returned when sending, so json acks match by `data.ackId`.
 *
 * @param {{kind: string, data: Object|null}} parsed - Result of `parseMessage`.
 * @param {string} expectedCmd - Pending token: a command char (legacy) or an ackId (json).
 * @returns {boolean} True when the message acknowledges the pending token.
 */
export function matchAck(parsed, expectedCmd) {
  if (!parsed || !parsed.data) {
    return false;
  }
  if (parsed.kind === 'legacy') {
    return parsed.data.cmd === expectedCmd;
  }
  if (parsed.kind === 'json') {
    return parsed.data.ackId === expectedCmd;
  }
  return false;
}