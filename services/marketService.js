'use strict';

const { randInt, randFloat, choice } = require('../utils/rng');

/**
 * Returns seeded market dynamics and area income data.
 * In production: swap with Zillow API, Redfin Data Center, or ATTOM market trends.
 *
 * Returns raw market signals — no score. scoringEngine.scoreAppreciation() computes the score.
 *
 * areaMedianMonthlyIncome: used by the affordability scorer as the DTI denominator.
 * Simulated range $4,500–$12,500/mo reflects US metro household income spread.
 */
function getMarketData(rng) {
  const growth24mo            = randFloat(rng, -3.0, 15.0, 1); // % price change over 24 months
  const inventory             = choice(rng, ['tightening', 'stable', 'slightly elevated', 'high']);
  const daysOnMarket          = randInt(rng, 5, 80);
  const priceToRent           = randInt(rng, 13, 36);
  const areaMedianMonthlyIncome = randInt(rng, 4500, 12500); // gross household income / 12

  return { growth24mo, inventory, daysOnMarket, priceToRent, areaMedianMonthlyIncome };
}

module.exports = { getMarketData };
