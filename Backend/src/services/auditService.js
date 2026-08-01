export class AuditService {
  constructor(maxLogs = 500) {
    this.logs = [];
    this.maxLogs = maxLogs;
    this.listeners = new Set();
  }

  addLog(entry) {
    const full = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    };

    this.logs.push(full);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.broadcast('AUDIT_LOG', full);
    return full;
  }

  broadcast(type, data) {
    const event = { type, data };
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
      }
    }
  }

  getLogs() {
    return this.logs.slice();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
