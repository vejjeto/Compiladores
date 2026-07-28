class TransmitterView {
  constructor() {
    this.wsManager = null;
    this.commandInput = document.getElementById('tx-command-input');
    this.executeBtn = document.getElementById('tx-execute-btn');
    this.clearBtn = document.getElementById('tx-clear-btn');
    this.clearLogsBtn = document.getElementById('tx-clear-logs-btn');
    this.logConsole = document.getElementById('tx-log-console');
    this.statusEl = document.getElementById('tx-status');
    this.videoPlayer = document.getElementById('tx-video-player');
    this.videoPlaceholder = document.getElementById('tx-video-placeholder');
    this.videoOverlay = document.getElementById('tx-video-overlay');

    this.videoActive = false;
    this.commandHistory = [];

    this.COMMAND_MAP = {
      A: { esp32: 'W', name: 'Avanzar' },
      R: { esp32: 'B', name: 'Retroceder' },
      D: { esp32: 'R', name: 'Girar Derecha' },
      I: { esp32: 'L', name: 'Girar Izquierda' },
      O: { esp32: 'O', name: 'Abrir Pinza' },
      C: { esp32: 'C', name: 'Cerrar Pinza' },
      P: { esp32: 'P', name: 'Encender Cámara' },
      F: { esp32: 'F', name: 'Apagar Cámara' }
    };

    this.bindEvents();
  }

  bindEvents() {
    this.executeBtn.addEventListener('click', () => this.executeProgram());
    this.clearBtn.addEventListener('click', () => this.clearInput());
    this.clearLogsBtn.addEventListener('click', () => this.clearLogs());

    this.commandInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.executeProgram();
      }
    });
  }

  initWebSocket(wsUrl) {
    this.wsManager = new WSManager(wsUrl, {
      onConnect: () => this.updateStatus('connected'),
      onDisconnect: () => this.updateStatus('disconnected'),
      onMessage: (data) => this.handleServerMessage(data),
      onReconnecting: (attempt) => {
        this.updateStatus('connecting');
        this.addLog(`Reconexión intento ${attempt}...`, 'warn');
      }
    });
    this.wsManager.connect();
  }

  updateStatus(state) {
    const dot = this.statusEl.querySelector('.status-dot');
    const label = this.statusEl.querySelector('span:last-child');

    dot.className = 'status-dot';
    switch (state) {
      case 'connected':
        dot.classList.add('status-connected');
        label.textContent = 'Conectado';
        break;
      case 'disconnected':
        dot.classList.add('status-disconnected');
        label.textContent = 'Desconectado';
        break;
      case 'connecting':
        dot.classList.add('status-connecting');
        label.textContent = 'Conectando...';
        break;
    }
  }

  parseAndValidate(input) {
    const errors = [];
    const raw = input.trim();

    if (!raw) {
      errors.push('El programa está vacío');
      return { valid: false, errors, commands: [] };
    }

    const tokens = raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
    const commands = [];

    const hasP = tokens.includes('P');
    const hasF = tokens.includes('F');
    const pIndex = tokens.indexOf('P');
    const fIndex = tokens.lastIndexOf('F');

    if (hasP && pIndex !== 0) {
      errors.push(`Error semántico: 'P' debe ser el primer comando (posición actual: ${pIndex + 1})`);
    }

    if (hasF && fIndex !== tokens.length - 1) {
      errors.push(`Error semántico: 'F' debe ser el último comando (posición actual: ${fIndex + 1})`);
    }

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const match = token.match(/^([A-Z])(?::([1-9]))?$/);

      if (!match) {
        errors.push(`Token inválido '${token}' en posición ${i + 1}`);
        continue;
      }

      const [, cmd, repStr] = match;
      const repetitions = repStr ? parseInt(repStr) : 1;

      if (!this.COMMAND_MAP[cmd]) {
        errors.push(`Comando desconocido '${cmd}' en posición ${i + 1}`);
        continue;
      }

      if (['P', 'F', 'O', 'C'].includes(cmd) && repStr) {
        errors.push(`Error semántico: '${cmd}' no acepta parámetro de repetición (encontrado '${token}')`);
        continue;
      }

      if (['A', 'R', 'D', 'I'].includes(cmd) && !repStr) {
        commands.push({ command: cmd, repetitions: 1, token });
      } else {
        commands.push({ command: cmd, repetitions, token });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      commands,
      raw,
      esp32Sequence: this.buildESP32Sequence(commands)
    };
  }

  buildESP32Sequence(commands) {
    const sequence = [];

    for (const cmd of commands) {
      const mapping = this.COMMAND_MAP[cmd.command];
      for (let i = 0; i < cmd.repetitions; i++) {
        sequence.push({
          char: mapping.esp32,
          command: cmd.command,
          name: mapping.name,
          step: i + 1
        });
      }
    }

    return sequence;
  }

  async executeProgram() {
    const input = this.commandInput.value;
    const parsed = this.parseAndValidate(input);

    if (!parsed.valid) {
      parsed.errors.forEach(err => this.addLog(err, 'invalid'));
      return;
    }

    this.addLog(`Programa: ${parsed.raw}`, 'info');
    this.addLog(`Secuencia ESP32: [${parsed.esp32Sequence.map(s => s.char).join(', ')}]`, 'command');

    if (parsed.commands.some(c => c.command === 'P') && !this.videoActive) {
      this.startVideo();
    }
    if (parsed.commands.some(c => c.command === 'F') && this.videoActive) {
      this.stopVideo();
    }

    if (!this.wsManager || !this.wsManager.isConnected) {
      this.addLog('No hay conexión con el servidor. Envío simulado.', 'warn');
      parsed.esp32Sequence.forEach((step, i) => {
        this.addLog(`Paso ${i + 1}: '${step.char}' → ${step.name}`, 'info');
      });
      return;
    }

    for (let i = 0; i < parsed.esp32Sequence.length; i++) {
      const step = parsed.esp32Sequence[i];
      try {
        this.addLog(`Enviando paso ${i + 1}/${parsed.esp32Sequence.length}: '${step.char}' (${step.name})`, 'info');
        const result = await this.wsManager.sendWithRetry({
          type: 'COMMAND',
          command: step.char,
          commandName: step.name,
          step: i + 1,
          total: parsed.esp32Sequence.length
        }, 3);
        this.addLog(`OK - Paso ${result.attempt}/3 intentos`, 'valid');
      } catch (err) {
        this.addLog(`FALLO paso ${i + 1}: ${err.message}`, 'invalid');
      }
    }

    this.addLog('Programa completado', 'valid');
  }

  handleServerMessage(data) {
    if (data.type === 'CONFIRMACION_COMANDO') {
      this.addLog(`Confirmación recibida: ${data.message}`, 'valid');
    } else if (data.type === 'AUDIT_LOG') {
      window.app.receiverView.addAuditLog(data);
    }
  }

  startVideo() {
    this.videoPlaceholder.classList.add('hidden');
    this.videoOverlay.classList.remove('hidden');
    this.videoActive = true;
    this.addLog('Cámara encendida (P)', 'valid');
  }

  stopVideo() {
    this.videoPlaceholder.classList.remove('hidden');
    this.videoOverlay.classList.add('hidden');
    this.videoActive = false;
    this.addLog('Cámara apagada (F)', 'warn');
  }

  addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const timestamp = new Date().toLocaleTimeString('es-MX', { hour12: false });

    entry.innerHTML = `
      <span class="log-timestamp">[${timestamp}]</span>
      <span class="log-message log-${type}">${this.escapeHtml(message)}</span>
    `;

    this.logConsole.appendChild(entry);
    this.logConsole.scrollTop = this.logConsole.scrollHeight;
  }

  clearInput() {
    this.commandInput.value = '';
  }

  clearLogs() {
    this.logConsole.innerHTML = '';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy() {
    if (this.wsManager) {
      this.wsManager.disconnect();
    }
  }
}
