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
const { geocodeAddress }                  = require('../services/geocodeService');

/**
 * POST /api/analyze-home
 * Body:    { address: string }
 * Returns: full home analysis report
 */
router.post('/', async (req, res) => {
  const { address } = req.body ?? {};

  if (!address || typeof address !== 'string' || address.trim().length < 5) {
    return res.status(400).json({ error: 'A valid US address is required (min 5 characters).' });
  }

  // Deterministic seed — same address always produces the same report
  const rng = createRng(strSeed(address.trim().toLowerCase()));

  // ── 1. Geocode ──────────────────────────────────────────────────────────────
  //    Best-effort: if geocoding fails we still run with mock data.
  let geoInfo = { city: '', stateAbbr: '' };
  try {
    geoInfo = await geocodeAddress(address.trim());
  } catch {
    // non-fatal — crime service falls back to mock when city/state are empty
  }

  // ── 2. Collect raw data from each service ───────────────────────────────────
  //    crime is async (may call FBI API); others remain sync mock services.
  const [crime, property, school, market, registry] = await Promise.all([
    getCrimeData(geoInfo, rng),
    Promise.resolve(getPropertyData(rng)),
    Promise.resolve(getSchoolData(rng)),
    Promise.resolve(getMarketData(rng)),
    Promise.resolve(getRegistryData(rng)),
  ]);

  // ── 3. Compute monthly cost ─────────────────────────────────────────────────
  const monthlyCost = getMonthlyCost(property);

  // ── 4. Run the scoring engine ────────────────────────────────────────────────
  const { composite: score, breakdown } = scoreHome({
    property: { listPrice: property.listPrice, estimatedValue: property.estValue },
    crime:    { violentPer1k: crime.violentPer1k, propertyPer1k: crime.propertyPer1k, trend: crime.trend },
    monthly:  { piti: monthlyCost.pi + monthlyCost.tax + monthlyCost.insurance, grossMonthlyIncome: market.areaMedianMonthlyIncome },
    school:   { rating: school.rating, nearestMiles: school.nearestMiles, schoolsInRadius: school.numInRadius },
    market:   { growth24mo: market.growth24mo, inventory: market.inventory, priceToRent: market.priceToRent, daysOnMarket: market.daysOnMarket },
  });

  const verdict = getVerdict(score);

  // ── 5. Build narrative content ───────────────────────────────────────────────
  const insights = buildInsights(rng, { crime, school, market, property }, breakdown);
  const risks    = buildRiskFlags(rng, { property, crime }, breakdown);

  // ── 6. Respond ───────────────────────────────────────────────────────────────
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
    crime,       // full crime object (includes real FBI data fields when available)
    geo: geoInfo,
  });
});

module.exports = router;
