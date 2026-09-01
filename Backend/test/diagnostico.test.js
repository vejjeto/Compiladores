import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runDiagnostico } from '../src/diagnostico.js';

describe('diagnostico', () => {
  it('devuelve un reporte con la estructura esperada', async () => {
    const mockCtx = {
      carService: {
        connected: false,
        connect: async () => { throw new Error('mock: no hay carro'); },
        disconnect: () => {}
      }
    };
    const report = await runDiagnostico(mockCtx);
    assert.ok(report && typeof report === 'object');
    assert.ok('pasos' in report);
    assert.strictEqual(Array.isArray(report.pasos), true);
    assert.ok(report.pasos.length > 0);
  });
});
