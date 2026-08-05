import { v4 as uuidv4 } from 'uuid';
import { info, warn, error } from '../utils/logger.js';
import { parseCommands, getCommandInfo, validateCommands, buildESP32Sequence, COMMAND_MAP } from '../core/parser.js';
import { classifyNumber, selectRandomNumber, NUMBER_TABLE } from '../core/encriptador.js';

const COMPONENT = 'TRANSMISOR';
const MAX_RETRIES = 3;
const ACK_TIMEOUT = 5000;

export class TransmisorService {
  constructor({ carService, auditService, stepDelay = 350, ackTimeout = ACK_TIMEOUT, maxRetries = MAX_RETRIES }) {
    this.carService = carService;
    this.auditService = auditService;
    this.stepDelay = stepDelay;
    this.ackTimeout = ackTimeout;
    this.maxRetries = maxRetries;
  }

  executeProgram(program) {
    const parsed = parseCommands(program);

    if (!parsed.valid) {
      return {
        ok: false,
        status: 400,
        valid: false,
        errors: parsed.errors,
        commands: parsed.commands
      };
    }

    if (!this.carService.connected) {
      return {
        ok: false,
        status: 409,
        valid: true,
        error: 'No hay conexión con el carro. Conecta la ESP32 en el panel Receptor o inicia el simulador.'
      };
    }

    const sequenceId = uuidv4();
    this.startSequence(sequenceId, parsed.esp32Sequence);

    info(COMPONENT, `Programa iniciado [${sequenceId}]: ${parsed.commands.length} comandos, ${parsed.esp32Sequence.length} pasos`);

    return {
      ok: true,
      status: 202,
      sequenceId,
      valid: true,
      raw: parsed.raw,
      commands: parsed.commands,
      esp32Sequence: parsed.esp32Sequence,
      totalSteps: parsed.esp32Sequence.length
    };
  }

  executeEncodedProgram(steps) {
    if (!Array.isArray(steps) || steps.length === 0) {
      return {
        ok: false,
        status: 400,
        valid: false,
        errors: ['El campo "pasos" debe ser un array no vacío'],
        decoded: []
      };
    }

    const decoded = [];
    const errors = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const numero = Number(step?.numero);
      const repeticiones = Number(step?.repeticiones);

      if (!Number.isInteger(numero) || numero < 1000 || numero > 9999) {
        errors.push(`Paso ${i + 1}: 'numero' debe ser un entero de 4 dígitos`);
        continue;
      }

      const classification = classifyNumber(numero);

      if (classification.classifiedAs !== 'VALIDO') {
        errors.push(`Paso ${i + 1}: N°${numero} rechazado (${classification.classifiedAs}): ${classification.details}`);
        this.auditService.addLog({
          command: classification.command,
          commandName: classification.command ? NUMBER_TABLE[classification.command]?.name : null,
          esp32Char: null,
          number: numero,
          classification: classification.classifiedAs,
          details: classification.details,
          results: classification.results,
          inTable: classification.inTable,
          source: 'programa-numeros'
        });
        continue;
      }

      const repetitions = Number.isInteger(repeticiones) && repeticiones >= 1 ? Math.min(repeticiones, 9) : 1;
      const mapping = COMMAND_MAP[classification.command];

      decoded.push({
        command: classification.command,
        repetitions,
        numero,
        token: `${classification.command}:${repetitions}`,
        esp32Char: mapping.esp32,
        name: mapping.name,
        type: mapping.type
      });
    }

    errors.push(...validateCommands(decoded));

    if (errors.length > 0) {
      return { ok: false, status: 400, valid: false, errors, decoded };
    }

    if (!this.carService.connected) {
      return {
        ok: false,
        status: 409,
        valid: true,
        error: 'No hay conexión con el carro. Conecta la ESP32 en el panel Receptor o inicia el simulador.'
      };
    }

    const sequence = buildESP32Sequence(decoded);
    const sequenceId = uuidv4();
    this.startSequence(sequenceId, sequence);

    info(COMPONENT, `Programa por números iniciado [${sequenceId}]: ${decoded.length} comandos, ${sequence.length} pasos`);

    return {
      ok: true,
      status: 202,
      sequenceId,
      valid: true,
      decoded,
      esp32Sequence: sequence,
      totalSteps: sequence.length
    };
  }

  executeCommand(command, repetitions = 1) {
    const commandInfo = getCommandInfo(command);

    if (!commandInfo) {
      return { ok: false, status: 400, error: `Comando desconocido '${command}'` };
    }

    const reps = Math.max(1, Math.min(parseInt(repetitions, 10) || 1, 9));
    const sequence = [];

    for (let i = 0; i < reps; i++) {
      sequence.push({
        char: commandInfo.esp32,
        command,
        name: commandInfo.name,
        step: i + 1,
        total: reps
      });
    }

    if (!this.carService.connected) {
      return {
        ok: false,
        status: 409,
        error: 'No hay conexión con el carro. Conecta la ESP32 en el panel Receptor o inicia el simulador.'
      };
    }

    const sequenceId = uuidv4();
    this.startSequence(sequenceId, sequence);

    return {
      ok: true,
      status: 202,
      sequenceId,
      command,
      repetitions: reps,
      esp32Char: commandInfo.esp32,
      name: commandInfo.name,
      totalSteps: reps
    };
  }

  sendRawChar(char) {
    if (!this.carService.connected) {
      return {
        ok: false,
        status: 409,
        error: 'No hay conexión con el carro. Conecta la ESP32 en el panel Receptor o inicia el simulador.'
      };
    }

    this.carService.sendCommand(char);

    this.auditService.addLog({
      command: null,
      commandName: null,
      esp32Char: char,
      number: null,
      classification: 'DIRECTO',
      details: `Comando crudo '${char}' enviado al carro`,
      results: null
    });

    return { ok: true, status: 200, char };
  }

  classifyNumber(number) {
    if (!Number.isInteger(Number(number))) {
      return { ok: false, status: 400, error: 'Número inválido' };
    }

    const result = classifyNumber(Number(number));

    this.auditService.addLog({
      command: result.command,
      commandName: result.command ? NUMBER_TABLE[result.command]?.name : null,
      esp32Char: null,
      number: result.number,
      classification: result.classifiedAs,
      details: result.details,
      results: result.results,
      inTable: result.inTable
    });

    info(COMPONENT, `Número ${result.number} clasificado como ${result.classifiedAs}`);

    return { ok: true, status: 200, ...result };
  }

  startSequence(sequenceId, sequence) {
    this.auditService.broadcast('SEQUENCE_STARTED', {
      sequenceId,
      totalSteps: sequence.length,
      timestamp: new Date().toISOString()
    });

    this.runSequence(sequenceId, sequence, 0, Date.now()).catch((err) => {
      error(COMPONENT, `Secuencia [${sequenceId}] error inesperado: ${err.message}`);
      this.auditService.broadcast('SEQUENCE_ERROR', {
        sequenceId,
        step: null,
        message: err.message,
        timestamp: new Date().toISOString()
      });
    });
  }

  async runSequence(sequenceId, sequence, index, startedAt) {
    if (index >= sequence.length) {
      this.auditService.broadcast('SEQUENCE_COMPLETED', {
        sequenceId,
        totalSteps: sequence.length,
        duration: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      });
      info(COMPONENT, `Secuencia [${sequenceId}] completada en ${Date.now() - startedAt}ms`);
      return;
    }

    const cmd = sequence[index];
    const stepNumber = index + 1;

    info(COMPONENT, `Secuencia [${sequenceId}] paso ${stepNumber}/${sequence.length}: '${cmd.char}' (${cmd.name})`);

    const number = cmd.numero ?? selectRandomNumber(cmd.command);
    const classification = number ? classifyNumber(number) : null;

    let acked = false;
    let attempt = 0;

    while (!acked && attempt < this.maxRetries) {
      attempt += 1;
      acked = await this.carService.waitForAck(cmd.char, this.ackTimeout);

      if (!acked) {
        warn(COMPONENT, `Secuencia [${sequenceId}] paso ${stepNumber}: sin ACK de '${cmd.char}' (intento ${attempt}/${this.maxRetries})`);
        this.auditService.broadcast('STEP_RETRY', {
          sequenceId,
          step: stepNumber,
          attempt,
          total: this.maxRetries,
          command: cmd.command,
          commandName: cmd.name,
          esp32Char: cmd.char,
          message: `Reintentando '${cmd.name}' (intento ${attempt}/${this.maxRetries})`,
          timestamp: new Date().toISOString()
        });
      }
    }

    if (!acked) {
      const message = `El carro no confirmó el comando '${cmd.char}' (${cmd.name}) tras ${this.maxRetries} intentos`;
      error(COMPONENT, `Secuencia [${sequenceId}] paso ${stepNumber}: ${message}`);
      this.auditService.broadcast('SEQUENCE_ERROR', {
        sequenceId,
        step: stepNumber,
        message,
        timestamp: new Date().toISOString()
      });
      return;
    }

    this.auditService.addLog({
      sequenceId,
      step: stepNumber,
      total: sequence.length,
      command: cmd.command,
      commandName: cmd.name,
      esp32Char: cmd.char,
      number,
      classification: classification?.classifiedAs ?? null,
      details: classification?.details ?? null,
      results: classification?.results ?? null
    });

    this.auditService.broadcast('STEP_SENT', {
      sequenceId,
      step: stepNumber,
      total: sequence.length,
      command: cmd.command,
      commandName: cmd.name,
      esp32Char: cmd.char,
      encryptedNumber: number,
      classification: classification?.classifiedAs ?? null,
      details: classification?.details ?? null,
      message: `OK_${cmd.name.toUpperCase().replace(/\s/g, '_')}:${stepNumber}`,
      ackId: uuidv4(),
      timestamp: new Date().toISOString()
    });

    await new Promise((r) => setTimeout(r, this.stepDelay));
    return this.runSequence(sequenceId, sequence, index + 1, startedAt);
  }
}
