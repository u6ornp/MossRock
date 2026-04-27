'use strict';

// Seeded linear congruential generator — same seed always produces same sequence
function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

// FNV-1a hash of a string → 32-bit seed
function strSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0;
  }
  return h;
}

const randInt   = (rng, lo, hi) => Math.floor(rng() * (hi - lo + 1)) + lo;
const randFloat = (rng, lo, hi, dp = 2) => parseFloat((rng() * (hi - lo) + lo).toFixed(dp));
const choice    = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffle   = (rng, arr) => [...arr].sort(() => rng() - 0.5);

module.exports = { createRng, strSeed, randInt, randFloat, choice, shuffle };
