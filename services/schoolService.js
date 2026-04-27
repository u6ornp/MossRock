'use strict';

const { randFloat, choice, randInt } = require('../utils/rng');

/**
 * Returns seeded school quality and proximity data.
 * In production: swap with GreatSchools API (developer.greatschools.org).
 *
 * Returns raw attributes — no score. scoringEngine.scoreSchoolQuality() computes the score.
 */
function getSchoolData(rng) {
  const rating       = choice(rng, ['Below Average', 'Average', 'Above Average', 'Excellent']);
  const nearestMiles = randFloat(rng, 0.2, 3.0, 1);
  const numInRadius  = randInt(rng, 1, 10);

  return { rating, nearestMiles, numInRadius };
}

module.exports = { getSchoolData };
