class ReceiverView {
  constructor(backendUrl) {
    this.backendUrl = backendUrl;
    this.eventSource = null;

    this.espIpInput = document.getElementById('rx-esp-ip');
    this.espPortInput = document.getElementById('rx-esp-port');
    this.connectBtn = document.getElementById('rx-connect-btn');
    this.disconnectBtn = document.getElementById('rx-disconnect-btn');
    this.logConsole = document.getElementById('rx-log-console');
    this.statusEl = document.getElementById('rx-esp-status');
    this.auditBreakdown = document.getElementById('rx-audit-breakdown');
    this.dictamen = document.getElementById('rx-dictamen');
    this.clearLogsBtn = document.getElementById('rx-clear-logs-btn');
    this.verifyInput = document.getElementById('rx-verify-input');
    this.verifyBtn = document.getElementById('rx-verify-btn');

    this.PRIMES = [41, 43, 47, 53, 59, 61];

    this.bindEvents();
    this.connectBackend();
    this.loadAuditHistory();
  }

  updateBackendUrl(url) {
    this.backendUrl = url;
    this.connectBackend();
    this.loadAuditHistory();
  }

  bindEvents() {
    this.connectBtn.addEventListener('click', () => this.connectToCar());
    this.disconnectBtn.addEventListener('click', () => this.disconnectFromCar());
    this.clearLogsBtn.addEventListener('click', () => this.clearLogs());

    if (this.verifyBtn) {
      this.verifyBtn.addEventListener('click', () => this.verifyNumber());
    }
  }

  connectBackend() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(`${this.backendUrl}/api/events`);

    this.eventSource.addEventListener('AUDIT_LOG', (e) => {
      this.renderAudit(JSON.parse(e.data));
    });

    this.eventSource.addEventListener('CAR_STATUS', (e) => {
      this.handleCarStatus(JSON.parse(e.data));
    });

    this.eventSource.addEventListener('CAR_MESSAGE', (e) => {
      const data = JSON.parse(e.data);
      this.addAuditLog(`Carro: ${data.message}`, 'info');
    });
  }

  async loadAuditHistory() {
    try {
      const res = await fetch(`${this.backendUrl}/api/audit`);
      const data = await res.json();
      (data.logs || []).forEach(log => this.renderAudit(log));
    } catch {
      this.addAuditLog(`No se pudo contactar al backend (${this.backendUrl})`, 'invalid');
    }
  }

  renderAudit(log) {
    if (log.results) {
      this.updateAuditBreakdown(log.results);
    }
    if (log.classification) {
      this.updateDictamen(log.classification);
    }

    const parts = [];
    if (log.commandName) parts.push(`${log.commandName} (${log.command})`);
    if (log.esp32Char) parts.push(`→ '${log.esp32Char}'`);
    if (log.number != null) parts.push(`N°${log.number}`);
    if (log.classification) parts.push(log.classification);
    if (log.details) parts.push(log.details);
    if (log.step != null) parts.push(`paso ${log.step}/${log.total}`);

    const message = parts.join(' | ') || 'Evento de auditoría';
    this.addAuditLog(message, this.logType(log.classification));
  }

  logType(classification) {
    switch (classification) {
      case 'VALIDO': return 'valid';
      case 'FALSO': return 'invalid';
      case 'CORRUPTO': return 'corrupt';
      case 'DIRECTO': return 'command';
      default: return 'info';
    }
  }

  handleCarStatus(data) {
    this.updateESPStatus(data.status);
    if (data.status === 'connected') {
      this.addAuditLog(`Carro conectado (${data.ip}:${data.port})`, 'valid');
    } else if (data.status === 'disconnected') {
      this.addAuditLog('Carro desconectado', 'invalid');
    } else if (data.status === 'error') {
      this.addAuditLog('Error de conexión con el carro', 'invalid');
    }
  }

  async connectToCar() {
    const ip = this.espIpInput.value.trim();
    const port = parseInt(this.espPortInput.value, 10) || 80;

    if (!ip) {
      this.addAuditLog('Error: Ingrese la dirección IP del carro', 'invalid');
      return;
    }

    try {
      this.addAuditLog(`Solicitando conexión al carro ${ip}:${port}...`, 'info');
      const res = await fetch(`${this.backendUrl}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, port })
      });
      const data = await res.json();

      if (!res.ok) {
        this.addAuditLog(`Error: ${data.error}`, 'invalid');
        return;
      }
    } catch (err) {
      this.addAuditLog(`No se pudo contactar al backend: ${err.message}`, 'invalid');
    }
  }

  async disconnectFromCar() {
    try {
      await fetch(`${this.backendUrl}/api/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
    } catch (err) {
      this.addAuditLog(`No se pudo contactar al backend: ${err.message}`, 'invalid');
    }
  }

  async verifyNumber() {
    const value = this.verifyInput.value.trim();

    if (!value || isNaN(Number(value))) {
      this.addAuditLog('Ingrese un número válido para verificar', 'invalid');
      return;
    }

    try {
      const res = await fetch(`${this.backendUrl}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: Number(value) })
      });
      const data = await res.json();

      if (!res.ok) {
        this.addAuditLog(`Error: ${data.error}`, 'invalid');
        return;
      }

      this.verifyInput.value = '';
    } catch (err) {
      this.addAuditLog(`No se pudo contactar al backend: ${err.message}`, 'invalid');
    }
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

  updateESPStatus(state) {
    const dot = this.statusEl.querySelector('.status-dot');
    const label = this.statusEl.querySelector('span:last-child');

    dot.className = 'status-dot';
    switch (state) {
      case 'connected':
        dot.classList.add('status-connected');
        label.textContent = 'Carro Conectado';
        break;
      case 'disconnected':
        dot.classList.add('status-disconnected');
        label.textContent = 'Carro Desconectado';
        break;
      case 'error':
        dot.classList.add('status-disconnected');
        label.textContent = 'Error de conexión';
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
    if (this.eventSource) {
      this.eventSource.close();
    }
  }
}
