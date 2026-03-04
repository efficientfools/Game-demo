export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

export function pickWeighted<T>(rng: () => number, options: Array<{ item: T; w: number }>): T {
  const total = options.reduce((a, b) => a + b.w, 0);
  let r = rng() * total;
  for (const o of options) {
    r -= o.w;
    if (r <= 0) return o.item;
  }
  return options[options.length - 1].item;
}
