class ReceiverView {
  constructor() {
    this.wsManager = null;
    this.espIpInput = document.getElementById('rx-esp-ip');
    this.espPortInput = document.getElementById('rx-esp-port');
    this.connectBtn = document.getElementById('rx-connect-btn');
    this.disconnectBtn = document.getElementById('rx-disconnect-btn');
    this.logConsole = document.getElementById('rx-log-console');
    this.statusEl = document.getElementById('rx-esp-status');
    this.auditBreakdown = document.getElementById('rx-audit-breakdown');
    this.dictamen = document.getElementById('rx-dictamen');
    this.clearLogsBtn = document.getElementById('rx-clear-logs-btn');

    this.PRIMES = [2, 3, 5, 7, 11, 13, 17, 19];

    this.NUMBER_TABLE = {
      A: { numbers: [1025, 1032, 1034, 1060, 1062, 1037], prime: 2, name: 'Avanzar' },
      R: { numbers: [1066, 1075, 1081, 1007, 1003, 1098], prime: 3, name: 'Retroceder' },
      D: { numbers: [1107, 1118, 1128, 1113, 1121, 1159], prime: 5, name: 'Girar Derecha' },
      I: { numbers: [1148, 1161, 1175, 1166, 1180, 1220], prime: 7, name: 'Girar Izquierda' },
      O: { numbers: [1189, 1204, 1222, 1219, 1239, 1281], prime: 11, name: 'Abrir Pinza' },
      F: { numbers: [1230, 1247, 1269, 1272, 1298, 1342], prime: 13, name: 'Apagar Cámara' },
      P: { numbers: [1271, 1290, 1316, 1325, 1357, 1403], prime: 17, name: 'Encender Cámara' },
      C: { numbers: [1312, 1333, 1363, 1378, 1416, 1464], prime: 19, name: 'Cerrar Pinza' }
    };

    this.ESP_COMMAND_MAP = {
      F: 'A', B: 'R', R: 'D', L: 'I',
      O: 'O', C: 'C', P: 'P', F: 'F'
    };

    this.bindEvents();
  }

  bindEvents() {
    this.connectBtn.addEventListener('click', () => this.connectToESP32());
    this.disconnectBtn.addEventListener('click', () => this.disconnectFromESP32());
    this.clearLogsBtn.addEventListener('click', () => this.clearLogs());
  }

  divisibilityAutomaton(number, prime) {
    const digits = number.toString().split('').map(Number);
    let state = 0;
    const a = 10 % prime;

    for (const digit of digits) {
      state = (a * state + digit) % prime;
    }

    return state === 0;
  }

  classifyNumber(number) {
    const results = {};
    let divisibleCount = 0;
    let matchingCommand = null;

    for (const [cmd, data] of Object.entries(this.NUMBER_TABLE)) {
      const isDivisible = this.divisibilityAutomaton(number, data.prime);
      results[data.prime] = isDivisible;
      if (isDivisible) {
        divisibleCount++;
        matchingCommand = cmd;
      }
    }

    let classifiedAs;
    let command = null;
    let details = '';

    const inTable = Object.values(this.NUMBER_TABLE).some(d => d.numbers.includes(number));

    if (!inTable) {
      classifiedAs = 'FALSO';
      details = `Número ${number} no pertenece a la tabla autorizada`;
    } else if (divisibleCount === 1) {
      classifiedAs = 'VALIDO';
      command = matchingCommand;
      const cmdData = this.NUMBER_TABLE[matchingCommand];
      details = `Divisible por ${cmdData.prime} → ${cmdData.name}`;
    } else if (divisibleCount === 0) {
      classifiedAs = 'FALSO';
      details = `Número ${number} en tabla pero no divisible por ningún primo`;
    } else {
      classifiedAs = 'CORRUPTO';
      const divisors = Object.entries(results)
        .filter(([_, v]) => v)
        .map(([k]) => k);
      details = `Divisible por ${divisibleCount} primos: [${divisors.join(', ')}]`;
    }

    return {
      number,
      results,
      classifiedAs,
      command,
      details,
      divisibleCount
    };
  }

  updateAuditBreakdown(results) {
    this.auditBreakdown.classList.remove('hidden');
    const checks = this.auditBreakdown.querySelectorAll('.prime-check');

    checks.forEach(el => {
      const prime = parseInt(el.dataset.prime);
      const icon = el.querySelector('.check-icon');
      const isDivisible = results[prime];

      icon.className = 'check-icon ' + (isDivisible ? 'check-pass' : 'check-fail');
      icon.textContent = isDivisible ? '✓' : 'X';
    });
  }

  updateDictamen(classification) {
    this.dictamen.classList.remove('hidden', 'dictamen-valid', 'dictamen-invalid', 'dictamen-corrupt');
    this.dictamen.textContent = classification;

    switch (classification) {
      case 'VALIDO':
        this.dictamen.classList.add('dictamen-valid');
        break;
      case 'FALSO':
        this.dictamen.classList.add('dictamen-invalid');
        break;
      case 'CORRUPTO':
        this.dictamen.classList.add('dictamen-corrupt');
        break;
    }
  }

  processEncryptedNumber(number) {
    this.addAuditLog(`Número recibido: ${number}`, 'info');

    const classification = this.classifyNumber(number);

    this.addAuditLog(`Desglose del autómata:`, 'info');
    for (const [prime, divisible] of Object.entries(classification.results)) {
      const status = divisible ? '✓ DIVISIBLE' : '✗ No divisible';
      this.addAuditLog(`  % ${prime}: ${status}`, divisible ? 'valid' : 'info');
    }

    this.updateAuditBreakdown(classification.results);
    this.updateDictamen(classification.classifiedAs);

    if (classification.classifiedAs === 'VALIDO') {
      const cmdData = this.NUMBER_TABLE[classification.command];
      this.addAuditLog(`Dictamen: VÁLIDO → ${cmdData.name} (${classification.command})`, 'valid');
      this.addAuditLog(`Comando desencriptado: ${classification.command}`, 'command');

      const espChar = this.mapToESP32(classification.command);
      this.addAuditLog(`Carácter ESP32: '${espChar}'`, 'command');

      return classification;
    } else if (classification.classifiedAs === 'FALSO') {
      this.addAuditLog(`Dictamen: FALSO - ${classification.details}`, 'invalid');
    } else {
      this.addAuditLog(`Dictamen: CORRUPTO - ${classification.details}`, 'corrupt');
    }

    return classification;
  }

  mapToESP32(command) {
    const map = {
      A: 'F', R: 'B', D: 'R', I: 'L',
      O: 'O', C: 'C', P: 'P', F: 'F'
    };
    return map[command] || '?';
  }

  connectToESP32() {
    const ip = this.espIpInput.value.trim();
    const port = this.espPortInput.value.trim();

    if (!ip) {
      this.addAuditLog('Error: Ingrese la dirección IP de la ESP32', 'invalid');
      return;
    }

    const wsUrl = `ws://${ip}:${port}/ws`;
    this.addAuditLog(`Conectando a ESP32 en ${wsUrl}...`, 'info');

    this.wsManager = new WSManager(wsUrl, {
      onConnect: () => {
        this.updateESPStatus('connected');
        this.addAuditLog('Conexión establecida con ESP32', 'valid');
      },
      onDisconnect: () => {
        this.updateESPStatus('disconnected');
        this.addAuditLog('Conexión con ESP32 perdida', 'invalid');
      },
      onMessage: (data) => this.handleESPMessage(data),
      onReconnecting: (attempt) => {
        this.updateESPStatus('connecting');
        this.addAuditLog(`Reintentando conexión... (${attempt})`, 'warn');
      }
    });

    this.wsManager.connect();
  }

  disconnectFromESP32() {
    if (this.wsManager) {
      this.wsManager.disconnect();
      this.wsManager = null;
      this.updateESPStatus('disconnected');
      this.addAuditLog('Desconectado de ESP32', 'warn');
    }
  }

  handleESPMessage(data) {
    if (data.type === 'ESP_RESPONSE') {
      this.addAuditLog(`ESP32 respondió: ${data.message}`, 'info');
    }
  }

  updateESPStatus(state) {
    const dot = this.statusEl.querySelector('.status-dot');
    const label = this.statusEl.querySelector('span:last-child');

    dot.className = 'status-dot';
    switch (state) {
      case 'connected':
        dot.classList.add('status-connected');
        label.textContent = 'ESP32 Conectada';
        break;
      case 'disconnected':
        dot.classList.add('status-disconnected');
        label.textContent = 'ESP32 Desconectada';
        break;
      case 'connecting':
        dot.classList.add('status-connecting');
        label.textContent = 'Conectando...';
        break;
    }
  }

  addAuditLog(message, type = 'info') {
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

  clearLogs() {
    this.logConsole.innerHTML = '';
    this.auditBreakdown.classList.add('hidden');
    this.dictamen.classList.add('hidden');
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
