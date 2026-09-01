import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  PROTOCOL_VERSION,
  buildCommand,
  buildAck,
  parseMessage,
  matchAck,
  VOCABULARY
} from '../src/protocol/commands.js';
import { tablaService } from '../src/services/tablaService.js';

tablaService.loadTableSync();

describe('PROTOCOL_VERSION', () => {
  it('is version 1', () => {
    assert.strictEqual(PROTOCOL_VERSION, 1);
  });
});

describe('buildCommand', () => {
  it('returns a JSON string with version, cmd, params and ackId', () => {
    const raw = buildCommand({ cmd: 'F', ackId: 'abc-123' });
    assert.strictEqual(typeof raw, 'string');

    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.v, 1);
    assert.strictEqual(parsed.cmd, 'F');
    assert.deepStrictEqual(parsed.params, {});
    assert.strictEqual(parsed.ackId, 'abc-123');
  });

  it('echoes params when provided', () => {
    const parsed = JSON.parse(buildCommand({ cmd: 'F', params: { speed: 3 }, ackId: 'x' }));
    assert.deepStrictEqual(parsed.params, { speed: 3 });
  });

  it('throws TypeError on unknown command', () => {
    assert.throws(() => buildCommand({ cmd: 'Z', ackId: 'x' }), TypeError);
  });
});

describe('buildAck', () => {
  it('returns a JSON ack string with version, ack flag, cmd, status and ackId', () => {
    const parsed = JSON.parse(buildAck({ cmd: 'F', ackId: 'abc' }));
    assert.strictEqual(parsed.v, 1);
    assert.strictEqual(parsed.ack, true);
    assert.strictEqual(parsed.cmd, 'F');
    assert.strictEqual(parsed.status, 'done');
    assert.strictEqual(parsed.ackId, 'abc');
  });

  it('defaults status to done', () => {
    const parsed = JSON.parse(buildAck({ cmd: 'R', ackId: 'y' }));
    assert.strictEqual(parsed.status, 'done');
  });
});

describe('parseMessage', () => {
  it('parses a JSON ack as kind json', () => {
    const payload = buildAck({ cmd: 'F', status: 'done', ackId: 'abc' });
    const parsed = parseMessage(payload);
    assert.strictEqual(parsed.kind, 'json');
    assert.deepStrictEqual(parsed.data, { ack: true, cmd: 'F', status: 'done', ackId: 'abc' });
  });

  it('parses a legacy ACK as kind legacy', () => {
    const parsed = parseMessage('ACK:F');
    assert.strictEqual(parsed.kind, 'legacy');
    assert.deepStrictEqual(parsed.data, { ack: true, cmd: 'F' });
  });

  it('parses a C.E firmware response as kind legacy', () => {
    const parsed = parseMessage('C.E F');
    assert.strictEqual(parsed.kind, 'legacy');
    assert.deepStrictEqual(parsed.data, { ack: true, cmd: 'F' });
  });

  it('treats garbage payloads as kind unknown', () => {
    const parsed = parseMessage('hello world');
    assert.strictEqual(parsed.kind, 'unknown');
    assert.strictEqual(parsed.data, null);
  });

  it('treats malformed JSON as kind json-invalid without throwing', () => {
    const parsed = parseMessage('{"v":1,"ack":true,"cmd":');
    assert.strictEqual(parsed.kind, 'json-invalid');
    assert.strictEqual(parsed.data, null);
  });

  it('treats valid JSON without the v1/ack shape as json-invalid', () => {
    assert.strictEqual(parseMessage('{"foo":"bar"}').kind, 'json-invalid');
    assert.strictEqual(parseMessage('{"v":2,"ack":true,"cmd":"F"}').kind, 'json-invalid');
  });
});

describe('matchAck', () => {
  it('matches legacy acks by command char', () => {
    const parsed = parseMessage('ACK:F');
    assert.strictEqual(matchAck(parsed, 'F'), true);
    assert.strictEqual(matchAck(parsed, 'B'), false);
  });

  it('matches json acks by ackId (not by command char)', () => {
    const parsed = parseMessage(buildAck({ cmd: 'F', ackId: 'ack-123' }));
    assert.strictEqual(matchAck(parsed, 'ack-123'), true);
    assert.strictEqual(matchAck(parsed, 'F'), false);
    assert.strictEqual(matchAck(parsed, 'ack-456'), false);
  });

  it('returns false for unknown or invalid kinds', () => {
    assert.strictEqual(matchAck(parseMessage('zzz'), 'F'), false);
    assert.strictEqual(matchAck(parseMessage('{"bad":'), 'F'), false);
  });
});

describe('VOCABULARY', () => {
  it('should map core ESP32 commands to standard semantic names', () => {
    // Es necesario inicializar la tabla para que se pueda leer
    import('../src/services/tablaService.js').then(({ tablaService }) => {
      tablaService.loadTableSync();
      const vocab = VOCABULARY();
      const expected = {
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

      for (const [char, standard] of Object.entries(expected)) {
        assert.ok(vocab[char], `VOCABULARY is missing '${char}'`);
        assert.strictEqual(vocab[char].standard, standard);
        assert.strictEqual(vocab[char].char, char);
      }
      assert.strictEqual(Object.keys(vocab).length, 9);
    });
  });
});