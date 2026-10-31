import { WebSocket } from 'ws';
import logger from '../utils/logger.js';
import { codificarPrograma } from '../core/encriptador.js';
import { parseCommands } from '../core/parser.js';
import { DEFAULT_CAR_IP, DEFAULT_CAR_PORT } from '../config/constants.js';

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

  async connect(url, role = 'transmitter') {
    if (this.connected) {
      this.disconnect();
    }

    // Construir lista de URLs candidatas: primero la pedida, luego fallbacks (/transmisor, /ws, /ws/peer)
    const candidateUrls = [url];
    try {
      const parsed = new URL(url);
      for (const fallbackPath of ['/transmisor', '/ws', '/ws/peer']) {
        const alt = `${parsed.protocol}//${parsed.host}${fallbackPath}`;
        if (!candidateUrls.includes(alt)) {
          candidateUrls.push(alt);
        }
      }
    } catch {}

    let lastErr = null;
    for (const targetUrl of candidateUrls) {
      try {
        return await this._connectSingle(targetUrl, role);
      } catch (err) {
        lastErr = err;
        // Si fue rechazado por ocupado (503 / 4001 / 4003), no reintentar otros paths
        if (/503|ocupad|modo transmisor/i.test(err.message)) {
          throw err;
        }
      }
    }
    throw lastErr || new Error('No se pudo conectar al receptor');
  }

  _connectSingle(url, role = 'transmitter') {
    this.url = url;
    this.role = role;
    this.isGitlabCompat = url.endsWith('/transmisor') || url.endsWith('/ws');

    return new Promise((resolve, reject) => {
      logger.info(COMPONENT, `Conectando peer en ${url} (rol: ${role}, gitlabCompat: ${this.isGitlabCompat})`);

      const ws = new WebSocket(url, { handshakeTimeout: 3000 });
      let settled = false;
      let graceTimer = null;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(graceTimer);
        this.ws = null;
        this.ip = null;
        this.port = null;
        this.url = null;
        this.role = null;
        try { ws.terminate(); } catch {}
        reject(err);
      };

      const timeout = setTimeout(() => {
        fail(new Error('No se pudo conectar al receptor (Timeout: IP no responde o servidor apagado)'));
      }, 3500);

      ws.on('open', () => {
        if (settled) return;
        // Breve ventana de gracia (80ms) por si el receptor acepta el upgrade y cierra de inmediato (ej. código 4001/4003 en Robert)
        graceTimer = setTimeout(() => {
          if (settled || ws.readyState !== WebSocket.OPEN) return;
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
          resolve({ ok: true, status: 'connected', role, address: this.address, path: new URL(url, 'ws://localhost').pathname });
        }, 80);
      });

      ws.on('message', (data) => {
        const str = data.toString();
        if (!settled) {
          try {
            const msg = JSON.parse(str);
            if (msg?.motivo === 'receptor_ocupado') {
              return fail(new Error('503 Receptor ocupado'));
            }
            if (msg?.motivo === 'rol_transmisor') {
              return fail(new Error('503 El receptor elegido está en modo transmisor'));
            }
          } catch {}
        }
        this._handleMessage(str);
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        clearTimeout(graceTimer);
        if (!settled) {
          const reasonStr = reason ? reason.toString() : '';
          if (code === 4001 || /ocupad/i.test(reasonStr)) {
            return fail(new Error('503 Receptor ocupado'));
          }
          if (code === 4003 || /transmisor/i.test(reasonStr)) {
            return fail(new Error('503 El equipo destino está en modo transmisor'));
          }
          return fail(new Error(`Conexión cerrada por el receptor (código ${code || 'desconocido'})`));
        }
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
        logger.error(COMPONENT, 'Error con el peer', { error: err.message });
        fail(err);
      });
    });
  }

  disconnect() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'disconnect', reason: 'Transmitter closing connection' }));
        }
      } catch {}
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

  async sendConnectCar(ip = DEFAULT_CAR_IP, port = DEFAULT_CAR_PORT, path = '/ws') {
    if (!this.connected) throw new Error('No hay conexión con el peer');

    const targetIp = ip || DEFAULT_CAR_IP;
    const targetPort = port || DEFAULT_CAR_PORT;
    const targetPath = (path && path.startsWith('/')) ? path : `/${path || 'ws'}`;
    
    // 1. Mensaje WS para receptores con protocolo JSON
    try {
      this.ws.send(JSON.stringify({ type: 'connect-car', ip: targetIp, port: targetPort, path: targetPath }));
    } catch {}

    // 2. Petición HTTP POST /robot para receptores con protocolo GitLab / Andrés Cuello
    let carConnected = false;
    try {
      const httpProto = this.url && this.url.startsWith('wss://') ? 'https' : 'http';
      const robotUrl = `ws://${targetIp}:${targetPort}${targetPath}`;
      const baseUrl = `${httpProto}://${this.ip}:${this.port || 80}`;
      const postUrl = `${baseUrl}/robot`;
      
      const resp = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: robotUrl }),
        signal: AbortSignal.timeout(3500)
      });
      if (resp.ok) {
        logger.info(COMPONENT, `Orden POST /robot enviada a ${postUrl} (robotUrl: ${robotUrl})`);
        // Verificar en /estado si el receptor realmente logró conectar al carro físico
        try {
          await new Promise(r => setTimeout(r, 800));
          const estadoResp = await fetch(`${baseUrl}/estado`, { signal: AbortSignal.timeout(2000) });
          if (estadoResp.ok) {
            const estadoData = await estadoResp.json();
            carConnected = estadoData.robot === 'conectado' || estadoData.carConnected === true;
          } else {
            carConnected = true;
          }
        } catch {
          carConnected = true;
        }
      } else {
        logger.warn(COMPONENT, `Receptor no pudo conectar al carro físico (HTTP ${resp.status})`);
      }
    } catch (err) {
      logger.warn(COMPONENT, `Aviso enviando POST /robot: ${err.message}`);
    }
    
    // 3. Enviar comando de cámara (N) solo si el carro realmente se conectó
    if (carConnected) {
      try {
        await this.sendCommand('N', 1);
        logger.info(COMPONENT, 'Comando cámara (N) enviado automáticamente');
      } catch (err) {
        logger.warn(COMPONENT, `Error enviando comando cámara: ${err.message}`);
      }
    } else {
      logger.warn(COMPONENT, 'Carro apagado o sin conexión: se omite encendido automático de cámara');
    }

    return { ok: carConnected };
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
