import { WsCarAdapter } from '../adapters/wsCarAdapter.js';
import logger from '../utils/logger.js';

const COMPONENT = 'CARRO';

export class CarService extends WsCarAdapter {
  constructor() {
    super({ dialect: 'legacy' });
    this._autoDetected = false;
  }

  _handleIncoming(message) {
    // Auto-detectar dialecto del primer mensaje recibido
    if (!this._autoDetected) {
      this._autoDetected = true;
      const msg = String(message).trim();
      if (msg.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed && parsed.v === 1 && parsed.ack === true) {
            this.setDialect('json');
            logger.info(COMPONENT, 'Auto-detectado: protocolo JSON v1');
          }
        } catch {
          // No es JSON válido, mantener legacy
        }
      } else if (msg.startsWith('C.E ') || msg.startsWith('ACK:')) {
        this.setDialect('legacy');
        logger.info(COMPONENT, 'Auto-detectado: protocolo legacy (' + msg.slice(0, 3) + ')');
      }
    }
    super._handleIncoming(message);
  }
}