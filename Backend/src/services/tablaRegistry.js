import { 
  JsonTablaAdapter, 
  ArrayTablaAdapter, 
  CsvTablaAdapter, 
  PlanaTablaAdapter, 
  ExternaTablaAdapter 
} from './tablaAdapter.js';

class TablaRegistry {
  constructor() {
    this.adapters = new Map();
    // Registrar los adaptadores por defecto
    this.register('json', new JsonTablaAdapter());
    this.register('array', new ArrayTablaAdapter());
    this.register('csv', new CsvTablaAdapter());
    this.register('plana', new PlanaTablaAdapter());
    this.register('externa', new ExternaTablaAdapter());
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

