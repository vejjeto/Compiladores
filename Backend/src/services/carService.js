import { WsCarAdapter } from '../adapters/wsCarAdapter.js';

export class CarService extends WsCarAdapter {
  constructor() {
    super({ dialect: 'legacy' });
  }
}