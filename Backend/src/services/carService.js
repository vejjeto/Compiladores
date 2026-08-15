import { WsCarAdapter } from '../adapters/wsCarAdapter.js';

/**
 * Thin facade over the WebSocket car transport.
 *
 * Keeps the historical name and API. Uses the legacy raw-char dialect by
 * default so server.js, transmisorService.js and existing tests keep working
 * unchanged.
 *
 * @extends WsCarAdapter
 */
export class CarService extends WsCarAdapter {
  constructor() {
    super({ dialect: 'legacy' });
  }
}