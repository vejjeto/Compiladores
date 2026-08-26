import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tablaRegistry } from './tablaRegistry.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../config/tablas.json');

const COMPONENT = 'TablaService';

export class TablaService {
  constructor() {
    this.primes = [];
    this.commands = {};
    this.loaded = false;
  }

  async loadTable(source = DEFAULT_CONFIG_PATH, format = 'json') {
    try {
      logger.info(COMPONENT, `Cargando tablas desde ${source} (formato: ${format})...`);
      const adapter = tablaRegistry.getAdapter(format);
      
      let rawData = source;
      
      if (format !== 'externa' && typeof source === 'string' && (source.endsWith('.json') || source.endsWith('.csv') || source.endsWith('.txt'))) {
         const content = fs.readFileSync(source, 'utf-8');
         rawData = content;
      }

      const parsed = await adapter.parse(rawData);
      
      this.primes = parsed.primes || [];
      this.commands = parsed.commands || {};
      this.loaded = true;
      
      logger.info(COMPONENT, `Tablas cargadas exitosamente. ${this.primes.length} primos, ${Object.keys(this.commands).length} comandos.`);
    } catch (error) {
      logger.error(COMPONENT, `Error cargando tablas: ${error.message}`);
      throw error;
    }
  }

  loadTableSync(source = DEFAULT_CONFIG_PATH, format = 'json') {
    try {
      logger.info(COMPONENT, `Cargando tablas síncronamente desde ${source} (formato: ${format})...`);
      
      let rawData = source;
      
      if (format !== 'externa' && typeof source === 'string' && (source.endsWith('.json') || source.endsWith('.csv') || source.endsWith('.txt'))) {
         const content = fs.readFileSync(source, 'utf-8');
         rawData = content;
      }

      let parsed;
      if (format === 'json') {
         parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      } else {
         throw new Error("loadTableSync solo soporta formato 'json' por ahora");
      }
      
      this.primes = parsed.primes || [];
      this.commands = parsed.commands || {};
      this.loaded = true;
      
      logger.info(COMPONENT, `Tablas cargadas síncronamente.`);
    } catch (error) {
      logger.error(COMPONENT, `Error cargando tablas síncronamente: ${error.message}`);
      throw error;
    }
  }

  getPrimes() {
    if (!this.loaded) throw new Error('Tablas no cargadas. Llama a loadTable() primero.');
    return this.primes;
  }

  getCommandMeta(commandChar) {
    if (!this.loaded) throw new Error('Tablas no cargadas. Llama a loadTable() primero.');
    return this.commands[commandChar] || null;
  }

  getAllCommands() {
    if (!this.loaded) throw new Error('Tablas no cargadas. Llama a loadTable() primero.');
    return this.commands;
  }

  getCommandByRange(number) {
    if (!this.loaded) throw new Error('Tablas no cargadas. Llama a loadTable() primero.');
    for (const [cmd, meta] of Object.entries(this.commands)) {
      if (number >= meta.min && number <= meta.max) {
        return meta;
      }
    }
    return null;
  }
}

// Singleton global
export const tablaService = new TablaService();

