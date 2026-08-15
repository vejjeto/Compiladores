import { EventEmitter } from 'events';

export const CAR_PORT_EVENTS = Object.freeze({
  STATUS: 'status',
  MESSAGE: 'message'
});

export class CarPort extends EventEmitter {
  get connected() {
    throw new Error('CarPort: not implemented by base class');
  }

  get address() {
    throw new Error('CarPort: not implemented by base class');
  }

  connect(ip, port = 80) {
    throw new Error('CarPort: not implemented by base class');
  }

  disconnect() {
    throw new Error('CarPort: not implemented by base class');
  }

  sendCommand(command) {
    throw new Error('CarPort: not implemented by base class');
  }

  waitForAck(command, timeout = 5000) {
    throw new Error('CarPort: not implemented by base class');
  }
}