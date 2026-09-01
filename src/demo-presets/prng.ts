/**
 * Deterministic PRNG for the demo-presets seed→relation triple
 * (ARCHITECTURE.md: "deterministic row generator"). mulberry32: 32-bit state,
 * one uniform per call, identical sequence for identical seed on every
 * platform — the property the pinned prd.md §6 aggregates depend on.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw 0..weights.length-1 with the given relative weights (integers). */
export function pickWeighted(rand: () => number, weights: readonly number[]): number {
  let total = 0;
  for (const weight of weights) total += weight;
  let threshold = rand() * total;
  for (let index = 0; index < weights.length; index++) {
    threshold -= weights[index] as number;
    if (threshold < 0) return index;
  }
  return weights.length - 1;
}

/** Uniform integer in lo..hi inclusive. */
export function intBetween(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}
