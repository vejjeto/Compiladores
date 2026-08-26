import { tablaService } from '../services/tablaService.js';

export function divisibilityAutomaton(number, prime) {
  if (!Number.isInteger(number) || number < 0) {
    return false;
  }

  const digits = number.toString().split('').map(Number);
  let state = 0;
  const a = 10 % prime;

  for (const digit of digits) {
    state = (a * state + digit) % prime;
  }

  return state === 0;
}

export function getAutomatonTransitions(number, prime) {
  if (!Number.isInteger(number) || number < 0) return null;
  
  const digits = number.toString().split('').map(Number);
  let state = 0;
  const a = 10 % prime;
  const transitions = [{ step: 0, digit: null, state: 0 }];

  for (let i = 0; i < digits.length; i++) {
    const digit = digits[i];
    const previousState = state;
    state = (a * state + digit) % prime;
    
    transitions.push({
      step: i + 1,
      digit: digit,
      previousState: previousState,
      state: state
    });
  }

  return { prime, transitions, isDivisible: state === 0 };
}

export function getClassificationResults(number) {
  const results = {};
  const primes = tablaService.getPrimes();

  for (const prime of primes) {
    results[prime] = divisibilityAutomaton(number, prime);
  }

  return results;
}

export function countDivisibilities(results) {
  return Object.values(results).filter(Boolean).length;
}

export function getDivisiblePrimes(results) {
  return Object.entries(results)
    .filter(([_, divisible]) => divisible)
    .map(([prime]) => parseInt(prime, 10));
}
