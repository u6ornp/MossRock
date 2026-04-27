'use strict';

const { randFloat, choice } = require('../utils/rng');

/**
 * Returns seeded crime rate data for a 3-mile radius.
 * In production: swap with FBI UCR API or local agency crime feeds.
 *
 * Returns raw rates — no score. scoringEngine.scoreCrimeTrend() computes the score.
 *
 * Simulated ranges are anchored to FBI UCR 2022 national averages:
 *   Violent crime:  ~3.7 per 1,000 residents
 *   Property crime: ~19.6 per 1,000 residents
 */
function getCrimeData(rng) {
  const violentPer1k   = randFloat(rng, 0.8, 12.0, 1);
  const propertyPer1k  = randFloat(rng, 5.0, 48.0, 1);
  const trend          = choice(rng, ['declining', 'stable', 'slight increase', 'increasing']);

  return { violentPer1k, propertyPer1k, trend };
}

module.exports = { getCrimeData };
