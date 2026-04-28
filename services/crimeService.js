'use strict';

const https         = require('https');
const { randFloat, choice } = require('../utils/rng');

// ── FBI Crime Data Explorer constants ─────────────────────────────────────────
// Register for a free API key at: https://api.usa.gov/signup
const FBI_BASE    = 'api.usa.gov';
const FBI_PATH    = '/crime/fbi/sapi';
const API_KEY     = process.env.FBI_API_KEY || '';

// FBI UCR 2022 national averages (per 1,000 residents) used for comparison
const NATIONAL_VIOLENT_PER1K  = 3.7;
const NATIONAL_PROPERTY_PER1K = 19.6;

// ── Small HTTP helper ──────────────────────────────────────────────────────────
function fbiGet(path) {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?';
    const options = {
      hostname: FBI_BASE,
      path:     `${FBI_PATH}${path}${sep}API_KEY=${API_KEY}`,
      method:   'GET',
      headers:  { 'Accept': 'application/json' },
      timeout:  12000,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid FBI API JSON')); }
      });
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('FBI API timed out')); });
    req.end();
  });
}

// ── Find the best matching agency ORI for a city ──────────────────────────────
async function findAgencyOri(city, stateAbbr) {
  const data = await fbiGet(`/agency/byStateAbbr/${stateAbbr}`);
  const agencies = Array.isArray(data) ? data : (data?.results ?? []);

  const cityUpper = city.toUpperCase();

  // Prefer police departments, then sheriffs
  const scored = agencies
    .filter(a => a.agency_name && a.ori)
    .map(a => {
      const name = a.agency_name.toUpperCase();
      let score = 0;
      if (name.includes(cityUpper))             score += 10;
      if (name.includes('POLICE DEPT'))         score += 5;
      if (name.includes('POLICE DEPARTMENT'))   score += 5;
      if (name.includes('CITY'))                score += 2;
      if (name.includes('SHERIFF'))             score += 1;
      return { ...a, _score: score };
    })
    .filter(a => a._score > 0)
    .sort((a, b) => b._score - a._score);

  return scored[0]?.ori ?? null;
}

// ── Pull summarized crime counts for an ORI, 3-year window ───────────────────
async function fetchCrimeSummary(ori) {
  const toYear   = new Date().getFullYear() - 1;   // most recent full year
  const fromYear = toYear - 2;                     // 3-year window

  const [violent, property] = await Promise.all([
    fbiGet(`/summarized/agency/${ori}/violent-crime?from=${fromYear}&to=${toYear}`),
    fbiGet(`/summarized/agency/${ori}/property-crime?from=${fromYear}&to=${toYear}`),
  ]);

  // Each endpoint returns an array of annual records: { data_year, actual, population, rate }
  const parseRecords = (raw) => {
    const arr = Array.isArray(raw) ? raw : (raw?.data ?? raw?.results ?? []);
    return arr
      .filter(r => r.data_year && r.population > 0)
      .sort((a, b) => b.data_year - a.data_year);   // newest first
  };

  const vRows = parseRecords(violent);
  const pRows = parseRecords(property);

  if (!vRows.length || !pRows.length) return null;

  // Use most recent year that has both datasets
  const latestYear = Math.min(vRows[0].data_year, pRows[0].data_year);
  const vLatest    = vRows.find(r => r.data_year === latestYear);
  const pLatest    = pRows.find(r => r.data_year === latestYear);

  // Per-1k from FBI rate field (rate = per 100k) or compute from actuals
  const toPerThousand = (row) => row.rate
    ? parseFloat((row.rate / 100).toFixed(1))
    : parseFloat(((row.actual / row.population) * 1000).toFixed(1));

  const violentPer1k  = toPerThousand(vLatest);
  const propertyPer1k = toPerThousand(pLatest);

  // Trend: compare latest year vs 2 years prior
  let trendPct = null;
  let trend    = 'stable';
  if (vRows.length >= 2) {
    const older = vRows[vRows.length - 1];
    if (older.rate && vLatest.rate) {
      trendPct = parseFloat((((vLatest.rate - older.rate) / older.rate) * 100).toFixed(1));
      if      (trendPct <= -5)  trend = 'declining';
      else if (trendPct <= 2)   trend = 'stable';
      else if (trendPct <= 10)  trend = 'slight increase';
      else                      trend = 'increasing';
    }
  }

  // Year-over-year history array (newest → oldest) for sparkline
  const history = vRows.slice(0, 4).map(r => ({
    year:          r.data_year,
    violentRate:   parseFloat((r.rate / 100).toFixed(2)),
    population:    r.population,
  }));

  // vs national baseline
  const vsNational = {
    violent:  parseFloat(((violentPer1k  / NATIONAL_VIOLENT_PER1K  - 1) * 100).toFixed(0)),
    property: parseFloat(((propertyPer1k / NATIONAL_PROPERTY_PER1K - 1) * 100).toFixed(0)),
  };

  return {
    source:         'FBI UCR / Crime Data Explorer',
    dataYear:       latestYear,
    violentPer1k,
    propertyPer1k,
    trend,
    trendPct,
    vsNational,
    history,
  };
}

// ── Detailed breakdown by offense type ────────────────────────────────────────
async function fetchOffenseBreakdown(ori) {
  const toYear   = new Date().getFullYear() - 1;
  const offenses = ['homicide', 'rape-legacy', 'robbery', 'aggravated-assault',
                    'burglary', 'larceny', 'motor-vehicle-theft'];

  const results = await Promise.allSettled(
    offenses.map(o => fbiGet(`/summarized/agency/${ori}/${o}?from=${toYear}&to=${toYear}`))
  );

  const breakdown = {};
  offenses.forEach((o, i) => {
    if (results[i].status === 'fulfilled') {
      const rows = results[i].value;
      const arr  = Array.isArray(rows) ? rows : (rows?.data ?? rows?.results ?? []);
      const row  = arr.find(r => r.data_year === toYear) ?? arr[0];
      if (row) breakdown[o] = { actual: row.actual ?? 0, rate: row.rate ?? 0 };
    }
  });

  return breakdown;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * getCrimeData({ city, stateAbbr }, rng)
 *
 * Tries FBI Crime Data Explorer API.  Falls back to deterministic mock data
 * (with a `source:'mock'` flag) if the API key is missing or the call fails.
 *
 * Returns:
 *   { source, dataYear?, violentPer1k, propertyPer1k, trend, trendPct?,
 *     vsNational?, history?, breakdown? }
 */
async function getCrimeData({ city, stateAbbr } = {}, rng) {
  if (API_KEY && city && stateAbbr) {
    try {
      const ori = await findAgencyOri(city, stateAbbr);
      if (ori) {
        const [summary, breakdown] = await Promise.all([
          fetchCrimeSummary(ori),
          fetchOffenseBreakdown(ori),
        ]);
        if (summary) {
          return { ...summary, breakdown, agency: ori };
        }
      }
    } catch (err) {
      // API error → fall through to mock
      console.warn(`[crimeService] FBI API failed (${err.message}), using mock data`);
    }
  }

  // ── Mock fallback ──────────────────────────────────────────────────────────
  const violentPer1k  = randFloat(rng, 0.8, 12.0, 1);
  const propertyPer1k = randFloat(rng, 5.0, 48.0, 1);
  const trend         = choice(rng, ['declining', 'stable', 'slight increase', 'increasing']);

  return {
    source:         'simulated (no FBI API key)',
    violentPer1k,
    propertyPer1k,
    trend,
    trendPct:       null,
    vsNational:     {
      violent:  parseFloat(((violentPer1k  / NATIONAL_VIOLENT_PER1K  - 1) * 100).toFixed(0)),
      property: parseFloat(((propertyPer1k / NATIONAL_PROPERTY_PER1K - 1) * 100).toFixed(0)),
    },
    history:    null,
    breakdown:  null,
  };
}

module.exports = { getCrimeData };
