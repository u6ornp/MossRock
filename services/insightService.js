'use strict';

const { randInt, choice, shuffle } = require('../utils/rng');

/**
 * Builds insight cards and risk flags from raw service data + computed scores.
 *
 * Insight sentiment (positive / neutral / concern) is derived from the engine's
 * computed breakdown scores so the wording and colour always match the score.
 */

// ── Insights ─────────────────────────────────────────────────────────────────

function buildInsights(rng, { crime, school, market, property }, breakdown) {
  const { yearBuilt, listPrice, estValue } = property;
  const { crimeTrend, schoolQuality, appreciation } = breakdown;

  const pool = [
    {
      type: market.growth24mo >= 4 ? 'positive' : market.growth24mo >= 0 ? 'neutral' : 'concern',
      icon: '📈', title: 'Market Appreciation',
      body: `This area saw an estimated ${Math.abs(market.growth24mo).toFixed(1)}% price ${market.growth24mo >= 0 ? 'growth' : 'decline'} over the past 24 months.`,
    },
    {
      type: schoolQuality >= 65 ? 'positive' : schoolQuality >= 45 ? 'neutral' : 'concern',
      icon: '🏫', title: 'School Proximity',
      body: `Nearest rated school is ${school.nearestMiles} mi away with a${['Above Average','Excellent'].includes(school.rating) ? 'n' : ''} ${school.rating} rating. ${school.numInRadius} schools within 3 miles.`,
    },
    {
      type: market.inventory === 'tightening' ? 'concern' : market.inventory === 'high' ? 'positive' : 'neutral',
      icon: '📦', title: 'Market Inventory',
      body: `Local listing inventory is ${market.inventory}. Median days on market: ${market.daysOnMarket} days.`,
    },
    {
      type: market.priceToRent <= 18 ? 'positive' : market.priceToRent >= 28 ? 'concern' : 'neutral',
      icon: '🏠', title: 'Price-to-Rent Ratio',
      body: `Estimated P/R ratio of ${market.priceToRent}. ${market.priceToRent <= 18 ? 'Buying appears to offer long-term value over renting.' : 'Renting comparable homes nearby may be cost-competitive.'}`,
    },
    {
      type: crimeTrend >= 65 ? 'positive' : crimeTrend >= 45 ? 'neutral' : 'concern',
      icon: '🔒', title: 'Crime Trend',
      body: `Reported incidents are ${crime.trend}. Violent crime: ${crime.violentPer1k}/1k residents. Property crime: ${crime.propertyPer1k}/1k.`,
    },
    {
      type: yearBuilt >= 2000 ? 'positive' : yearBuilt >= 1985 ? 'neutral' : 'concern',
      icon: '🔧', title: 'Home Age & Condition',
      body: `Built in ${yearBuilt}. ${yearBuilt >= 2000 ? 'Relatively modern construction.' : yearBuilt >= 1985 ? 'Mid-age home — verify HVAC and roof condition.' : 'Older home — thorough inspection of plumbing and electrical recommended.'}`,
    },
    {
      type: listPrice <= estValue ? 'positive' : 'concern',
      icon: '💰', title: 'Price vs. Estimated Value',
      body: `List price is ${Math.round(Math.abs(listPrice - estValue) / estValue * 100)}% ${listPrice > estValue ? 'above' : 'below'} the estimated market value of $${estValue.toLocaleString()}.`,
    },
    {
      type: 'neutral',
      icon: '🌊', title: 'Climate Exposure',
      body: `Area has ${choice(rng, ['moderate flood risk', 'elevated wildfire exposure', 'high wind event frequency', 'low natural hazard exposure'])} per climate risk models.`,
    },
    {
      type: 'neutral',
      icon: '🚗', title: 'Commute Profile',
      body: `Average commute time to city center estimated at ${randInt(rng, 15, 55)} minutes by car.`,
    },
  ];

  return shuffle(rng, pool).slice(0, 6);
}

// ── Risk flags ────────────────────────────────────────────────────────────────

function buildRiskFlags(rng, { property, crime }, breakdown) {
  const { listPrice, estValue, yearBuilt } = property;
  const overpricedPct = Math.round(Math.abs(listPrice - estValue) / estValue * 100);

  const pool = [
    {
      level: 'high', icon: '🔴', title: 'Flood Zone Proximity',
      body: 'Property is within 500 ft of a mapped 100-year flood plain. Flood insurance may be required by lender.',
    },
    {
      level: listPrice > estValue ? 'medium' : 'low',
      icon:  listPrice > estValue ? '🟡' : '🟢',
      title: 'List vs. Estimated Value',
      body: `List price is ${overpricedPct}% ${listPrice > estValue ? 'above' : 'below'} our estimated market value of $${estValue.toLocaleString()}.`,
    },
    {
      level: 'low', icon: '🟢', title: 'HOA Fees Present',
      body: 'Property may be subject to HOA dues. Confirm monthly amount and review CC&Rs before closing.',
    },
    {
      level: 'clear', icon: '✅', title: 'No Open Permits Found',
      body: 'No open building permits were detected in public records for this address.',
    },
    {
      level: breakdown.crimeTrend < 50 ? 'medium' : 'low',
      icon:  breakdown.crimeTrend < 50 ? '🟡' : '🟢',
      title: 'Crime Index',
      body: `Crime trend score: ${breakdown.crimeTrend}/100. Reported incidents are ${crime.trend}.`,
    },
    {
      level: yearBuilt < 1980 ? 'medium' : 'low',
      icon:  yearBuilt < 1980 ? '🟡' : '🟢',
      title: 'Aging Infrastructure',
      body: `Home built in ${yearBuilt}. Schedule a professional inspection covering roof, electrical, and plumbing.`,
    },
  ];

  return shuffle(rng, pool).slice(0, 4);
}

module.exports = { buildInsights, buildRiskFlags };
