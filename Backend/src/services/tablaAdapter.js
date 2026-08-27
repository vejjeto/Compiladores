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
