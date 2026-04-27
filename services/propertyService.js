'use strict';

const { randInt, randFloat } = require('../utils/rng');

/**
 * Returns seeded property details.
 * In production: swap with ATTOM Data Solutions API.
 *
 * Scoring logic deliberately excluded — all scores are computed by scoringEngine.js
 * from the raw values returned here.
 */
function getPropertyData(rng) {
  const listPrice = randInt(rng, 280000, 850000);
  const estValue  = Math.round(listPrice * randFloat(rng, 0.93, 1.08));
  const beds      = randInt(rng, 2, 5);
  const baths     = randFloat(rng, 1.0, 3.5, 1);
  const sqft      = randInt(rng, 900, 3800);
  const yearBuilt = randInt(rng, 1955, 2020);
  const taxRate   = randFloat(rng, 0.8, 2.4, 2);
  const annTax    = Math.round(estValue * taxRate / 100);

  return { listPrice, estValue, beds, baths, sqft, yearBuilt, taxRate, annTax };
}

/**
 * Computes true monthly cost breakdown assuming 20% down, 6.89% 30-year fixed.
 * Returns individual line items so the scoring engine can separate PITI from
 * the maintenance reserve (maintenance is not part of housing DTI).
 */
function getMonthlyCost(property) {
  const { listPrice, annTax } = property;
  const loanAmt     = listPrice * 0.80;
  const r           = 6.89 / 100 / 12;
  const n           = 360;
  const pi          = Math.round(loanAmt * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
  const tax         = Math.round(annTax / 12);
  const insurance   = Math.round(listPrice * 0.0045 / 12);
  const maintenance = Math.round(listPrice * 0.01 / 12);
  return { pi, tax, insurance, maintenance, total: pi + tax + insurance + maintenance };
}

module.exports = { getPropertyData, getMonthlyCost };
