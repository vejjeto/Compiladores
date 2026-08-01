class App {
  constructor() {
    this.currentRole = 'transmitter';
    this.backendUrl = localStorage.getItem('backendUrl') || `${window.location.protocol}//${window.location.hostname}:3000`;

    this.transmitterView = new TransmitterView(this.backendUrl);
    this.receiverView = new ReceiverView(this.backendUrl);

    this.roleButtons = document.querySelectorAll('.role-btn');
    this.views = {
      transmitter: document.getElementById('view-transmitter'),
      receiver: document.getElementById('view-receiver')
    };

    this.backendInput = document.getElementById('backend-url-input');
    this.backendApplyBtn = document.getElementById('backend-url-apply');

    this.init();
  }

  init() {
    this.roleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchRole(btn.dataset.role);
      });
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
    const value = (this.backendInput.value.trim() || `${window.location.protocol}//${window.location.hostname}:3000`).replace(/\/+$/, '');
    this.backendUrl = value;
    localStorage.setItem('backendUrl', value);
    this.transmitterView.updateBackendUrl(value);
    this.receiverView.updateBackendUrl(value);
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
  }

  destroy() {
    this.transmitterView.destroy();
    this.receiverView.destroy();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
