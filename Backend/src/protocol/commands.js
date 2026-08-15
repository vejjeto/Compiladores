import { COMMAND_MAP } from '../core/parser.js';

export const PROTOCOL_VERSION = 1;

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

export function buildCommand({ cmd, params = {}, ackId } = {}) {
  if (!COMMAND_MAP[cmd]) {
    throw new TypeError(`buildCommand: unknown command '${cmd}'`);
  }
  return JSON.stringify({ v: PROTOCOL_VERSION, cmd, params, ackId });
}

export function buildAck({ cmd, status = 'done', ackId } = {}) {
  return JSON.stringify({ v: PROTOCOL_VERSION, ack: true, cmd, status, ackId });
}

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