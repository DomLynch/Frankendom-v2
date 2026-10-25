// Seeded PRNG (mulberry32). The sim's only source of randomness; state is one
// uint32 so it snapshots and replays with the rest of the sim state.

export function createRng(seed) {
  return { s: seed >>> 0 };
}

export function next(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
