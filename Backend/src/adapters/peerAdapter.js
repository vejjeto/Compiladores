import { WebSocket } from 'ws';
import logger from '../utils/logger.js';
import { codificarPrograma } from '../core/encriptador.js';
import { parseCommands } from '../core/parser.js';

const COMPONENT = 'PEER';
const CONNECT_TIMEOUT = 5000;

export class PeerAdapter {
  constructor({ ctx }) {
    this.ctx = ctx;
    this.ws = null;
    this.ip = null;
    this.port = null;
    this.role = null;
    this.isGitlabCompat = false;
    this.listeners = new Set();
  }

  get connected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get address() {
    return this.ip ? `${this.ip}:${this.port}` : null;
  }

  connect(url, role = 'transmitter') {
    if (this.connected) {
      this.disconnect();
    }

    this.url = url;
    this.role = role;
    this.isGitlabCompat = url.endsWith('/transmisor');

    return new Promise((resolve, reject) => {
      logger.info(COMPONENT, `Conectando peer en ${url} (rol: ${role}, gitlabCompat: ${this.isGitlabCompat})`);

      const ws = new WebSocket(url);
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.terminate();
          reject(new Error('No se pudo conectar al receptor (Timeout: IP no responde o servidor apagado)'));
        }
      }, CONNECT_TIMEOUT);

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.ws = ws;

        try {
          const urlObj = new URL(url);
          this.ip = urlObj.hostname;
          this.port = urlObj.port || (urlObj.protocol === 'wss:' ? '443' : '80');
        } catch {
          this.ip = url;
          this.port = 'unknown';
        }

        logger.success(COMPONENT, `Peer conectado en ${url} (rol: ${role})`);
        this._notifyListeners({ type: 'peer-connected', role, address: this.address });
        resolve({ ok: true, status: 'connected', role, address: this.address });
      });

      ws.on('message', (data) => {
        this._handleMessage(data.toString());
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        if (this.ws === ws) {
          this.ws = null;
          this.ip = null;
          this.port = null;
          this.url = null;
          logger.warn(COMPONENT, 'Peer desconectado');
          this._notifyListeners({ type: 'peer-disconnected' });
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        logger.error(COMPONENT, 'Error con el peer', { error: err.message });
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  disconnect() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch {}
      this.ip = null;
      this.port = null;
      this.url = null;
      this.role = null;
      logger.warn(COMPONENT, 'Desconectando peer');
      this._notifyListeners({ type: 'peer-disconnected' });
    }
  }

  sendCommand(command, repetitions = 1) {
    if (!this.connected) throw new Error('No hay conexión con el peer');
    if (this.isGitlabCompat) {
      const { numeroUnico } = codificarPrograma([{ command, repetitions }]);
      if (numeroUnico) this.ws.send(numeroUnico);
    } else {
      this.ws.send(JSON.stringify({ type: 'command', command, repetitions }));
    }
  }

  sendProgram(program) {
    if (!this.connected) throw new Error('No hay conexión con el peer');
    if (this.isGitlabCompat) {
      const parsed = parseCommands(program);
      if (parsed.valid) {
        const { numeroUnico } = codificarPrograma(parsed.commands);
        this.ws.send(numeroUnico);
      }
    } else {
      this.ws.send(JSON.stringify({ type: 'program', program }));
    }
  }

  sendProgramaNumeros(programa) {
    if (!this.connected) throw new Error('No hay conexión con el peer');
    if (this.isGitlabCompat) {
      this.ws.send(programa);
    } else {
      this.ws.send(JSON.stringify({ type: 'programa-numeros', programa }));
    }
  }

  sendRawChar(char) {
    if (!this.connected) throw new Error('No hay conexión con el peer');
    if (this.isGitlabCompat) {
      // Intenta mandarlo codificado, aunque no se recomienda para raw en GitLab
      const { numeroUnico } = codificarPrograma([{ command: char, repetitions: 1 }]);
      if (numeroUnico) this.ws.send(numeroUnico);
    } else {
      this.ws.send(JSON.stringify({ type: 'raw', char }));
    }
  }

  async sendConnectCar(ip, port) {
    if (!this.connected) throw new Error('No hay conexión con el peer');
    
    // 1. Mensaje WS para receptores con protocolo JSON
    try {
      this.ws.send(JSON.stringify({ type: 'connect-car', ip, port }));
    } catch {}

    // 2. Petición HTTP POST /robot para receptores con protocolo GitLab / Andrés Cuello
    try {
      const httpProto = this.url && this.url.startsWith('wss://') ? 'https' : 'http';
      const robotUrl = `ws://${ip}:${port || 80}/ws`;
      const postUrl = `${httpProto}://${this.ip}:${this.port || 80}/robot`;
      
      await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: robotUrl })
      });
      logger.info(COMPONENT, `Orden POST /robot enviada a ${postUrl} (robotUrl: ${robotUrl})`);
    } catch (err) {
      logger.warn(COMPONENT, `Aviso enviando POST /robot: ${err.message}`);
    }
  }

  sendEvent(event, data) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ type: 'event', event, data }));
  }

  sendCarMessage(message) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ type: 'car-message', message }));
  }

  sendCarStatus(status) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ type: 'car-status', status }));
  }

  onMessage(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _notifyListeners(msg) {
    for (const cb of this.listeners) {
      try { cb(msg); } catch {}
    }
  }

  async _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.tipo === 'progreso') {
      this._notifyListeners({ type: 'peer-progreso', fase: msg.fase, comando: msg.comando, detalle: msg });
      if (this.ctx.auditService) {
        this.ctx.auditService.broadcast('PEER_PROGRESS', { fase: msg.fase, comando: msg.comando, detalle: msg });
      }
      return;
    }

    if (msg.estado) {
      this._notifyListeners({ type: 'peer-program-result', estado: msg.estado, comando: msg.comando, motivo: msg.motivo });
      if (this.ctx.auditService) {
        this.ctx.auditService.broadcast('PEER_PROGRAM_RESULT', { estado: msg.estado, comando: msg.comando, motivo: msg.motivo });
      }
      return;
    }

    switch (msg.type) {
      case 'command':
        this._handleRemoteCommand(msg.command);
        break;
      case 'connect-car-result':
        this._notifyListeners({ type: 'connect-car-result', ok: msg.ok, message: msg.message, error: msg.error });
        break;
      case 'event':
        this._notifyListeners({ type: 'peer-event', event: msg.event, data: msg.data });
        break;
      case 'car-message':
        this._notifyListeners({ type: 'peer-car-message', message: msg.message });
        break;
      case 'car-status':
        this._notifyListeners({ type: 'peer-car-status', status: msg.status });
        break;
    }
  }

  async _handleRemoteCommand(command) {
    const { carService, transmisorService, auditService } = this.ctx;

    if (!carService.connected) {
      logger.warn(COMPONENT, `Comando remoto '${command}' rechazado: carro no conectado`);
      this.sendEvent('COMMAND_ERROR', { command, error: 'Carro no conectado en el receptor' });
      return;
    }

    logger.info(COMPONENT, `Ejecutando comando remoto '${command}'`);

    const result = transmisorService.executeCommand(command);

    if (result.ok) {
      // Forward sequence events back to the peer via subscription (no monkey-patch)
      const unsub = auditService.subscribe(({ type, data }) => {
        this.sendEvent(type, data);
      });

      // Auto-unsubscribe after max sequence duration (safety net)
      setTimeout(() => { unsub(); }, 60000);

      this.sendEvent('COMMAND_ACCEPTED', { command, sequenceId: result.sequenceId });
    } else {
      this.sendEvent('COMMAND_ERROR', { command, error: result.error });
    }
  }
}
