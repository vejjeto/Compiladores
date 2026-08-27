import { JsonTablaAdapter } from './tablaAdapter.js';

class TablaRegistry {
  constructor() {
    this.adapters = new Map();
    // Registrar el adaptador por defecto
    this.register('json', new JsonTablaAdapter());
  }

  register(format, adapterInstance) {
    this.adapters.set(format.toLowerCase(), adapterInstance);
  }

  getAdapter(format) {
    const adapter = this.adapters.get(format.toLowerCase());
    if (!adapter) {
      throw new Error(`No hay un adapter registrado para el formato '${format}'`);
    }
    return adapter;
  }
}

// Singleton
export const tablaRegistry = new TablaRegistry();

