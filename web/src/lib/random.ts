// Deterministic PRNG (mulberry32) so the demo data looks the same on every load.
export function createRandom(seed: number) {
  let state = seed;

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function inRange(min: number, max: number): number {
    return min + next() * (max - min);
  }

  function int(min: number, max: number): number {
    return Math.floor(inRange(min, max + 1));
  }

  function pick<T>(items: readonly T[]): T {
    return items[int(0, items.length - 1)];
  }

  return { next, inRange, int, pick };
}
