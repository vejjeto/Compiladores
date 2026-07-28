import { v4 as uuidv4 } from 'uuid';
import { info, warn, error, success, event } from '../utils/logger.js';
import { parseCommands } from '../core/parser.js';
import { classifyNumber, selectRandomNumber } from '../core/encriptador.js';

const COMPONENT = 'TRANSMISOR';

export class TransmisorService {
  constructor() {
    this.clients = new Map();
  }

  handleConnection(ws, req) {
    const clientId = this.generateId();
    this.clients.set(clientId, { ws, connectedAt: new Date() });

    success(COMPONENT, `Transmisor conectado [${clientId}]`);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.processMessage(clientId, ws, message);
      } catch (err) {
        error(COMPONENT, `Error procesando mensaje [${clientId}]`, { error: err.message });
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      warn(COMPONENT, `Transmisor desconectado [${clientId}]`);
    });

    ws.on('error', (err) => {
      error(COMPONENT, `Error en transmisor [${clientId}]`, { error: err.message });
    });

    const serverAckId = uuidv4();
    this.sendACK(ws, serverAckId, {
      type: 'CONNECTED',
      message: 'Conexión establecida con el servidor backend',
      clientId
    });
  }

  processMessage(clientId, ws, message) {
    event(COMPONENT, `Mensaje recibido [${clientId}]`, { type: message.type });

    if (message.type === 'COMMAND') {
      this.handleCommand(clientId, ws, message);
    } else if (message.type === 'PARSE_PROGRAM') {
      this.handleParseProgram(clientId, ws, message);
    } else if (message.type === 'CLASSIFY_NUMBER') {
      this.handleClassifyNumber(clientId, ws, message);
    } else {
      warn(COMPONENT, `Tipo de mensaje desconocido: ${message.type}`);
    }
  }

  handleCommand(clientId, ws, message) {
    const { command, commandName, step, total, ackId } = message;

    info(COMPONENT, `Comando [${clientId}]: '${command}' (${commandName}) paso ${step}/${total}`);

    const commandChar = this.getCommandFromChar(command);
    const randomNum = selectRandomNumber(commandChar);
    const classification = randomNum ? classifyNumber(randomNum) : null;

    const serverAckId = uuidv4();
    this.sendACK(ws, ackId || serverAckId, {
      type: 'CONFIRMACION_COMANDO',
      message: `OK_${commandName?.toUpperCase().replace(/\s/g, '_')}:${step}`,
      command,
      commandName,
      step,
      total,
      encryptedNumber: randomNum,
      classification: classification?.classifiedAs
    });
  }

  handleParseProgram(clientId, ws, message) {
    const { program, ackId } = message;
    const parsed = parseCommands(program);

    info(COMPONENT, `Programa parseado [${clientId}]: ${parsed.commands.length} comandos, válido: ${parsed.valid}`);

    const serverAckId = uuidv4();
    this.sendACK(ws, ackId || serverAckId, {
      type: 'PARSE_RESULT',
      ...parsed
    });
  }

  handleClassifyNumber(clientId, ws, message) {
    const { number, ackId } = message;
    const classification = classifyNumber(number);

    info(COMPONENT, `Clasificación [${clientId}]: ${number} → ${classification.classifiedAs}`);

    const serverAckId = uuidv4();
    this.sendACK(ws, ackId || serverAckId, {
      type: 'CLASSIFICATION_RESULT',
      ...classification
    });
  }

  sendACK(ws, ackId, data) {
    if (ws.readyState === ws.OPEN) {
      const payload = { ...data, ackId: ackId || uuidv4() };
      ws.send(JSON.stringify(payload));
    }
  }

  broadcastToAll(data) {
    const message = JSON.stringify(data);
    for (const [, client] of this.clients) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(message);
      }
    }
  }

  getCommandFromChar(char) {
    const map = { W: 'A', F: 'A', B: 'R', R: 'D', L: 'I', O: 'O', C: 'C', P: 'P' };
    return map[char] || char;
  }

  generateId() {
    return 'tx-' + uuidv4().substring(0, 8);
  }
}
