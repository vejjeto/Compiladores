export class TablaAdapter {
  /**
   * Procesa la fuente de datos y devuelve un objeto estandarizado.
   * @param {any} source 
   * @returns {Object} { primes: [], commands: {} }
   */
  async parse(source) {
    throw new Error('Método parse() debe ser implementado por la subclase');
  }
}

export class JsonTablaAdapter extends TablaAdapter {
  async parse(source) {
    let data;
    if (typeof source === 'string') {
      data = JSON.parse(source);
    } else {
      data = source; // Asumimos que ya es objeto
    }
    return {
      primes: data.primes || [],
      commands: data.commands || {}
    };
  }
}

export class ArrayTablaAdapter extends TablaAdapter {
  async parse(source) {
    // Formato hipotético: [{ cmd: 'F', min: 1000, max: 1999 }, ...]
    const commands = {};
    if (Array.isArray(source.commands)) {
      for (const item of source.commands) {
        commands[item.cmd] = {
          esp32: item.cmd,
          name: item.name || '',
          type: item.type || 'action',
          min: item.min,
          max: item.max
        };
      }
    }
    return {
      primes: source.primes || [],
      commands
    };
  }
}

export class CsvTablaAdapter extends TablaAdapter {
  async parse(source) {
    // Implementación básica hipotética para CSV
    // cmd,name,type,min,max
    const commands = {};
    const lines = typeof source === 'string' ? source.split('\n') : [];
    
    // Ignoramos la primera línea de headers (simplificado)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const [cmd, name, type, min, max] = line.split(',');
      if (cmd) {
        commands[cmd] = {
          esp32: cmd,
          name: name || '',
          type: type || 'action',
          min: parseInt(min, 10),
          max: parseInt(max, 10)
        };
      }
    }
    return {
      primes: [], // CSV simple no trae primes, requeriría otro archivo
      commands
    };
  }
}

export class PlanaTablaAdapter extends TablaAdapter {
  async parse(source) {
    // Implementación básica para archivo de texto plano
    const commands = {};
    const lines = typeof source === 'string' ? source.split('\n') : [];
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [cmd, range] = line.split(':');
        const [min, max] = range.split('-');
        commands[cmd.trim()] = {
          esp32: cmd.trim(),
          name: '',
          type: 'action',
          min: parseInt(min, 10),
          max: parseInt(max, 10)
        };
      }
    }
    return {
      primes: [],
      commands
    };
  }
}

export class ExternaTablaAdapter extends TablaAdapter {
  async parse(source) {
    // source sería una URL
    try {
      const response = await fetch(source);
      const data = await response.json();
      return {
        primes: data.primes || [],
        commands: data.commands || {}
      };
    } catch (err) {
      throw new Error(`Error cargando tabla externa: ${err.message}`);
    }
  }
}

