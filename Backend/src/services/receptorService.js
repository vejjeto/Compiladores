import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';
import { info, warn, error, success, event } from '../utils/logger.js';
import { classifyNumber } from '../core/encriptador.js';

const COMPONENT = 'RECEPTOR';

const ESP_COMMAND_DELAY = 350;

export class ReceptorService {
  constructor() {
    this.receiverClients = new Map();
    this.esp32Clients = new Map();
    this.activeSequences = new Map();
  }

  handleReceiverConnection(ws, req) {
    const clientId = this.generateId('rx');
    this.receiverClients.set(clientId, { ws, connectedAt: new Date() });

    success(COMPONENT, `Receptor Frontend conectado [${clientId}]`);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.processReceiverMessage(clientId, ws, message);
      } catch (err) {
        error(COMPONENT, `Error procesando mensaje del Receptor [${clientId}]`, { error: err.message });
      }
    });

    ws.on('close', () => {
      this.receiverClients.delete(clientId);
      warn(COMPONENT, `Receptor Frontend desconectado [${clientId}]`);
    });

    ws.on('error', (err) => {
      error(COMPONENT, `Error en Receptor [${clientId}]`, { error: err.message });
    });
  }

  handleESP32Connection(ws, req) {
    const clientId = this.generateId('esp');
    this.esp32Clients.set(clientId, { ws, connectedAt: new Date(), ip: req.socket.remoteAddress });

    success(COMPONENT, `ESP32 conectada [${clientId}] desde ${req.socket.remoteAddress}`);

    this.broadcastToReceivers({
      type: 'ESP_STATUS',
      status: 'connected',
      espId: clientId
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.processESP32Message(clientId, ws, message);
      } catch (err) {
        error(COMPONENT, `Error procesando mensaje de ESP32 [${clientId}]`, { error: err.message });
      }
    });

    ws.on('close', () => {
      this.esp32Clients.delete(clientId);
      warn(COMPONENT, `ESP32 desconectada [${clientId}]`);

      this.broadcastToReceivers({
        type: 'ESP_STATUS',
        status: 'disconnected',
        espId: clientId
      });
    });

    ws.on('error', (err) => {
      error(COMPONENT, `Error en ESP32 [${clientId}]`, { error: err.message });
    });
  }

  processReceiverMessage(clientId, ws, message) {
    event(COMPONENT, `Mensaje del Receptor [${clientId}]`, { type: message.type });

    switch (message.type) {
      case 'CONNECT_ESP32':
        this.connectToESP32(clientId, message.ip, message.port);
        break;

      case 'SEND_TO_ESP32':
        this.sendToESP32(clientId, message.command, message.ackId);
        break;

      case 'SEND_SEQUENCE':
        this.handleSendSequence(clientId, message.sequence, message.ackId);
        break;

      case 'PROCESS_NUMBER':
        this.processEncryptedNumber(clientId, message.number, message.ackId);
        break;

      default:
        warn(COMPONENT, `Tipo de mensaje desconocido del Receptor: ${message.type}`);
    }
  }

  connectToESP32(receiverId, ip, port = 8080) {
    const wsUrl = `ws://${ip}:${port}/ws`;
    info(COMPONENT, `Conectando a ESP32 en ${wsUrl}`);

    try {
      const espWs = new WebSocket(wsUrl);

      espWs.on('open', () => {
        success(COMPONENT, `Conexión establecida con ESP32 en ${wsUrl}`);

        const espClientId = this.generateId('esp-direct');
        this.esp32Clients.set(espClientId, {
          ws: espWs,
          connectedAt: new Date(),
          ip,
          port,
          receiverId
        });

        this.sendToReceiver(receiverId, {
          type: 'ESP_STATUS',
          status: 'connected',
          ip,
          port
        });
      });

      espWs.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.processESP32Message('esp-direct', espWs, message);
        } catch (err) {
          error(COMPONENT, `Error procesando respuesta ESP32`, { error: err.message });
        }
      });

      espWs.on('close', () => {
        warn(COMPONENT, `Conexión con ESP32 cerrada`);
        this.sendToReceiver(receiverId, {
          type: 'ESP_STATUS',
          status: 'disconnected'
        });
      });

      espWs.on('error', (err) => {
        error(COMPONENT, `Error conectando a ESP32`, { error: err.message });
        this.sendToReceiver(receiverId, {
          type: 'ESP_STATUS',
          status: 'error',
          error: err.message
        });
      });

    } catch (err) {
      error(COMPONENT, `Error creando conexión WebSocket a ESP32`, { error: err.message });
    }
  }

  async sendToESP32(receiverId, command, ackId) {
    const espClient = this.findESP32ForReceiver(receiverId);

    if (!espClient || espClient.ws.readyState !== WebSocket.OPEN) {
      warn(COMPONENT, `No hay conexión con ESP32 para Receptor [${receiverId}]`);

      if (ackId) {
        this.sendToReceiver(receiverId, {
          type: 'ESP_SEND_ERROR',
          message: 'No hay conexión con la ESP32',
          ackId
        });
      }
      return;
    }

    try {
      info(COMPONENT, `Enviando a ESP32: '${command}'`);

      espClient.ws.send(JSON.stringify({
        type: 'COMMAND',
        command
      }));

      const serverAckId = uuidv4();
      if (ackId) {
        this.sendToReceiver(receiverId, {
          type: 'ESP_SEND_OK',
          message: `Comando '${command}' enviado a ESP32`,
          command,
          ackId: serverAckId
        });
      }

    } catch (err) {
      error(COMPONENT, `Error enviando a ESP32`, { error: err.message });

      if (ackId) {
        this.sendToReceiver(receiverId, {
          type: 'ESP_SEND_ERROR',
          message: err.message,
          ackId
        });
      }
    }
  }

  handleSendSequence(receiverId, sequence, ackId) {
    const espClient = this.findESP32ForReceiver(receiverId);

    if (!espClient || espClient.ws.readyState !== WebSocket.OPEN) {
      warn(COMPONENT, `No hay conexión con ESP32 para enviar secuencia [${receiverId}]`);

      if (ackId) {
        this.sendToReceiver(receiverId, {
          type: 'SEQUENCE_ERROR',
          message: 'No hay conexión con la ESP32',
          ackId
        });
      }
      return;
    }

    const sequenceId = uuidv4();
    this.activeSequences.set(sequenceId, {
      receiverId,
      espClient,
      sequence,
      currentIndex: 0,
      startedAt: new Date()
    });

    info(COMPONENT, `Iniciando secuencia [${sequenceId}]: ${sequence.length} pasos con ${ESP_COMMAND_DELAY}ms de delay`);

    const serverAckId = uuidv4();
    if (ackId) {
      this.sendToReceiver(receiverId, {
        type: 'SEQUENCE_STARTED',
        sequenceId,
        totalSteps: sequence.length,
        ackId: serverAckId
      });
    }

    this.executeSequenceStep(sequenceId);
  }

  executeSequenceStep(sequenceId) {
    const seq = this.activeSequences.get(sequenceId);

    if (!seq) return;

    if (seq.currentIndex >= seq.sequence.length) {
      const duration = Date.now() - seq.startedAt.getTime();
      info(COMPONENT, `Secuencia [${sequenceId}] completada en ${duration}ms`);

      this.sendToReceiver(seq.receiverId, {
        type: 'SEQUENCE_COMPLETED',
        sequenceId,
        totalSteps: seq.sequence.length,
        duration
      });

      this.activeSequences.delete(sequenceId);
      return;
    }

    const cmd = seq.sequence[seq.currentIndex];

    info(COMPONENT, `Secuencia [${sequenceId}] paso ${seq.currentIndex + 1}/${seq.sequence.length}: '${cmd.char}' (${cmd.name})`);

    try {
      seq.espClient.ws.send(JSON.stringify({
        type: 'COMMAND',
        command: cmd.char
      }));

      this.sendToReceiver(seq.receiverId, {
        type: 'SEQUENCE_STEP_SENT',
        sequenceId,
        step: seq.currentIndex + 1,
        total: seq.sequence.length,
        command: cmd.char,
        commandName: cmd.name
      });

      this.broadcastToReceivers({
        type: 'AUDIT_LOG',
        number: null,
        classification: 'COMANDO_DIRECTO',
        command: cmd.command,
        details: `Paso ${seq.currentIndex + 1}: '${cmd.char}' → ${cmd.name}`,
        results: null,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      error(COMPONENT, `Error en secuencia [${sequenceId}] paso ${seq.currentIndex + 1}`, { error: err.message });

      this.sendToReceiver(seq.receiverId, {
        type: 'SEQUENCE_ERROR',
        sequenceId,
        message: err.message,
        step: seq.currentIndex + 1
      });

      this.activeSequences.delete(sequenceId);
      return;
    }

    seq.currentIndex++;

    if (seq.currentIndex < seq.sequence.length) {
      setTimeout(() => this.executeSequenceStep(sequenceId), ESP_COMMAND_DELAY);
    } else {
      const duration = Date.now() - seq.startedAt.getTime();
      info(COMPONENT, `Secuencia [${sequenceId}] completada en ${duration}ms`);

      this.sendToReceiver(seq.receiverId, {
        type: 'SEQUENCE_COMPLETED',
        sequenceId,
        totalSteps: seq.sequence.length,
        duration
      });

      this.activeSequences.delete(sequenceId);
    }
  }

  processESP32Message(espId, ws, message) {
    event(COMPONENT, `Mensaje de ESP32 [${espId}]`, { type: message.type });

    if (message.type === 'RESPONSE') {
      this.broadcastToReceivers({
        type: 'ESP_RESPONSE',
        espId,
        message: message.data || message.message,
        timestamp: new Date().toISOString()
      });
    } else if (message.type === 'SENSOR_DATA') {
      this.broadcastToReceivers({
        type: 'ESP_SENSOR_DATA',
        espId,
        data: message.data,
        timestamp: new Date().toISOString()
      });
    }
  }

  processEncryptedNumber(receiverId, number, ackId) {
    const classification = classifyNumber(number);

    info(COMPONENT, `Número ${number} clasificado como: ${classification.classifiedAs}`);

    const serverAckId = uuidv4();
    this.sendToReceiver(receiverId, {
      type: 'CLASSIFICATION_RESULT',
      ...classification,
      ackId: serverAckId
    });

    this.broadcastToReceivers({
      type: 'AUDIT_LOG',
      number,
      classification: classification.classifiedAs,
      command: classification.command,
      details: classification.details,
      results: classification.results,
      timestamp: new Date().toISOString()
    });
  }

  findESP32ForReceiver(receiverId) {
    for (const [, client] of this.esp32Clients) {
      if (client.receiverId === receiverId) {
        return client;
      }
    }
    return null;
  }

  sendToReceiver(receiverId, data) {
    const client = this.receiverClients.get(receiverId);
    if (client && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  broadcastToReceivers(data) {
    const message = JSON.stringify(data);
    for (const [, client] of this.receiverClients) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(message);
      }
    }
  }

  generateId(prefix) {
    return `${prefix}-${uuidv4().substring(0, 8)}`;
  }
}
