'use strict';

const express = require('express');
const router  = express.Router();

const { createRng, strSeed }              = require('../utils/rng');
const { scoreHome, getVerdict }           = require('../utils/scoringEngine');
const { getPropertyData, getMonthlyCost } = require('../services/propertyService');
const { getCrimeData }                    = require('../services/crimeService');
const { getSchoolData }                   = require('../services/schoolService');
const { getMarketData }                   = require('../services/marketService');
const { getRegistryData }                 = require('../services/registryService');
const { buildInsights, buildRiskFlags }   = require('../services/insightService');

/**
 * POST /api/analyze-home
 * Body:    { address: string }
 * Returns: full home analysis report
 */
router.post('/', (req, res) => {
  const { address } = req.body ?? {};

  if (!address || typeof address !== 'string' || address.trim().length < 5) {
    return res.status(400).json({ error: 'A valid US address is required (min 5 characters).' });
  }

  // Deterministic seed — same address always produces the same report
  const rng = createRng(strSeed(address.trim().toLowerCase()));

  // ── 1. Collect raw data from each mock service ──────────────────────────────
  //    In production, replace each call with a real third-party API fetch.
  const property = getPropertyData(rng);
  const crime    = getCrimeData(rng);
  const school   = getSchoolData(rng);
  const market   = getMarketData(rng);
  const registry = getRegistryData(rng);

  // ── 2. Compute monthly cost ─────────────────────────────────────────────────
  //    Done before scoring so PITI is available as an affordability input.
  const monthlyCost = getMonthlyCost(property);

  // ── 3. Run the scoring engine ────────────────────────────────────────────────
  //    Each factor receives only the specific raw fields it needs, keeping
  //    the engine free of service-layer assumptions.
  const { composite: score, breakdown } = scoreHome({
    property: { listPrice: property.listPrice, estimatedValue: property.estValue },
    crime:    { violentPer1k: crime.violentPer1k, propertyPer1k: crime.propertyPer1k, trend: crime.trend },
    // PITI = PI + tax + insurance. Maintenance is excluded from housing DTI by convention.
    monthly:  { piti: monthlyCost.pi + monthlyCost.tax + monthlyCost.insurance, grossMonthlyIncome: market.areaMedianMonthlyIncome },
    school:   { rating: school.rating, nearestMiles: school.nearestMiles, schoolsInRadius: school.numInRadius },
    market:   { growth24mo: market.growth24mo, inventory: market.inventory, priceToRent: market.priceToRent, daysOnMarket: market.daysOnMarket },
  });

  const verdict  = getVerdict(score);

  // ── 4. Build narrative content from service data + computed breakdown ────────
  const insights = buildInsights(rng, { crime, school, market, property }, breakdown);
  const risks    = buildRiskFlags(rng, { property, crime }, breakdown);

  // ── 5. Respond ───────────────────────────────────────────────────────────────
  //    Map internal engine keys → public API contract keys.
  //    Internal: priceFairness / crimeTrend / schoolQuality
  //    Public:   price         / crime      / schools
  res.json({
    score,
    verdict,
    breakdown: {
      price:         breakdown.priceFairness,
      crime:         breakdown.crimeTrend,
      affordability: breakdown.affordability,
      schools:       breakdown.schoolQuality,
      appreciation:  breakdown.appreciation,
    },
    property,
    monthlyCost,
    insights,
    risks,
    registryDensity: registry,
  });
});

module.exports = router;
