export const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19];

export function divisibilityAutomaton(number, prime) {
  const digits = number.toString().split('').map(Number);
  let state = 0;
  const a = 10 % prime;

  for (const digit of digits) {
    state = (a * state + digit) % prime;
  }

  return state === 0;
}

export function getClassificationResults(number) {
  const results = {};

  for (const prime of PRIMES) {
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
