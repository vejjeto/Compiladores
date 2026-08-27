class App {
  constructor() {
    this.currentRole = 'transmitter';
    this.backendUrl = this.normalizeBackendUrl(localStorage.getItem('backendUrl')) || this.inferBackendUrl();

    const transportMode = 'ws';
    this.client = new BackendClient(this.backendUrl, transportMode);
    this.transmitterView = new TransmitterView(this.client);
    this.receiverView = new ReceiverView(this.client);

    this.hookBeeps();

    this.roleButtons = document.querySelectorAll('[data-role]');
    this.views = {
      transmitter: document.getElementById('view-transmitter'),
      receiver: document.getElementById('view-receiver')
    };

    this.backendInput = document.getElementById('backend-url-input');
    this.backendApplyBtn = document.getElementById('backend-url-apply');

    this.init();
  }

  inferBackendUrl() {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  normalizeBackendUrl(raw) {
    if (!raw) return null;

    let value = String(raw).trim().replace(/\/+$/, '');

    value = value.replace(/^(https?:\/\/)+/i, (match) => {
      const proto = match.toLowerCase().includes('https') ? 'https://' : 'http://';
      return proto;
    });

    if (!/^https?:\/\//i.test(value)) {
      value = `http://${value}`;
    }

    try {
      const parsed = new URL(value);
      if (!parsed.hostname) return null;
      return value;
    } catch {
      return null;
    }
  }

  init() {
    this.roleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchRole(btn.dataset.role);
      });
    });

    // Transport mode is forced to 'ws' - disable transport buttons if present
    this.transportButtons = document.querySelectorAll('[data-transport]');
    this.transportButtons.forEach(btn => {
      btn.disabled = true;
      btn.title = 'Modo WebSocket forzado';
    });

    if (this.backendInput) {
      this.backendInput.value = this.backendUrl;
    }
    if (this.backendApplyBtn) {
      this.backendApplyBtn.addEventListener('click', () => this.applyBackendUrl());
    }

    this.transmitterView.addLog(`Backend configurado: ${this.backendUrl}`, 'info');
    this.transmitterView.addLog('Seleccione un programa de comandos y presione "Ejecutar Programa"', 'info');
    this.receiverView.addAuditLog(`Backend configurado: ${this.backendUrl}`, 'info');
    this.receiverView.addAuditLog('Ingrese la IP del carro y presione "Conectar Carro"', 'info');
  }

  applyBackendUrl() {
    const value = this.normalizeBackendUrl(this.backendInput.value);
    if (!value) {
      this.transmitterView.addLog('URL de backend inválida. Usá el formato http://IP:3000', 'invalid');
      this.receiverView.addAuditLog('URL de backend inválida. Usá el formato http://IP:3000', 'invalid');
      return;
    }
    this.backendUrl = value;
    localStorage.setItem('backendUrl', value);
    this.client.setBaseUrl(value);
    this.transmitterView.addLog(`Backend configurado: ${value}`, 'info');
    this.receiverView.addAuditLog(`Backend configurado: ${value}`, 'info');
  }

  switchRole(role) {
    if (role === this.currentRole) return;

    this.currentRole = role;

    this.roleButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.role === role);
    });

    Object.values(this.views).forEach(view => {
      view.classList.remove('active');
    });

    this.views[role].classList.add('active');

    if (role === 'receiver') {
      this.receiverView.loadAuditHistory();
    }
  }

  hookBeeps() {
    const wrapLogs = (view, methodName) => {
      const original = view[methodName].bind(view);
      view[methodName] = (message, type = 'info') => {
        if (type !== 'info') {
          if (type === 'valid') Beep.success();
          else if (type === 'invalid' || type === 'corrupt') Beep.error();
          else if (type === 'warn') Beep.warn();
          else Beep.click();
        }
        original(message, type);
      };
    };

    wrapLogs(this.transmitterView, 'addLog');
    wrapLogs(this.receiverView, 'addAuditLog');

    const clickBtn = (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => Beep.click());
    };

    clickBtn('tx-execute-btn');
    clickBtn('tx-clear-btn');
    clickBtn('tx-clear-logs-btn');
    clickBtn('tx-connect-car-btn');
    clickBtn('tx-disconnect-car-btn');
    clickBtn('rx-clear-logs-btn');
    clickBtn('rx-verify-btn');
    clickBtn('backend-url-apply');
  }

  destroy() {
    this.client.destroy();
    this.transmitterView.destroy();
    this.receiverView.destroy();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

const Beep = (() => {
  let ctx = null;
  let gain = null;
  let filter = null;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    gain = ctx.createGain();
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.8;
    gain.connect(filter);
    filter.connect(ctx.destination);
    gain.gain.value = 0.05;
  }

  function tone(freq, dur, type = 'sine') {
    ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(gain);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur / 1000);
    o.start(now);
    o.stop(now + dur / 1000);
  }

  return {
    click:   () => tone(440, 45),
    success: () => { tone(392, 60, 'triangle'); setTimeout(() => tone(523, 70, 'triangle'), 70); },
    error:   () => tone(110, 130, 'triangle'),
    warn:    () => tone(330, 80),
  };
})();