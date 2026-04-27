'use strict';

/**
 * MossRock Home Decision Engine — Scoring Engine
 * ═══════════════════════════════════════════════
 *
 * Produces a deterministic 0–100 Home Score from structured property data.
 * Each of the five factors is independently scored 0–100, then combined
 * using a fixed weighted average.
 *
 * ┌─────────────────────────┬────────┬─────────────────────────────────────────┐
 * │ Factor                  │ Weight │ Question it answers                     │
 * ├─────────────────────────┼────────┼─────────────────────────────────────────┤
 * │ Price Fairness          │  25%   │ Are you paying fair market value?       │
 * │ Crime Trend             │  20%   │ Is the neighborhood safe and improving? │
 * │ Affordability           │  20%   │ Can the buyer sustain the payments?     │
 * │ School Quality          │  15%   │ How good and accessible are schools?    │
 * │ Appreciation Potential  │  20%   │ Does the market have upside?            │
 * └─────────────────────────┴────────┴─────────────────────────────────────────┘
 *
 * ─── WORKED EXAMPLE ─────────────────────────────────────────────────────────
 *
 * Input:
 *   {
 *     property: { listPrice: 485_000, estimatedValue: 470_000 },
 *     crime:    { violentPer1k: 3.2, propertyPer1k: 18.5, trend: 'declining' },
 *     monthly:  { piti: 2_840, grossMonthlyIncome: 9_500 },
 *     school:   { rating: 'Above Average', nearestMiles: 0.8, schoolsInRadius: 5 },
 *     market:   { growth24mo: 6.4, inventory: 'stable', priceToRent: 21, daysOnMarket: 22 },
 *   }
 *
 * Step-by-step:
 *   priceFairness  → ratio = 1.032  → 100 − 0.032×500 = 84
 *   crimeTrend     → index = 37.7   → base 62, trend +10 = 72
 *   affordability  → DTI  = 29.9%   → lerp(28→75, 36→45) = 68
 *   schoolQuality  → base 70 − 5 (dist) + 10 (density) = 75
 *   appreciation   → 33 + 18 + 8 + 13 = 72
 *
 *   composite = 84×0.25 + 72×0.20 + 68×0.20 + 75×0.15 + 72×0.20 = 75
 *
 * Output:
 *   {
 *     composite: 75,
 *     breakdown: {
 *       priceFairness: 84,
 *       crimeTrend:    72,
 *       affordability: 68,
 *       schoolQuality: 75,
 *       appreciation:  72,
 *     },
 *     weights: { priceFairness:0.25, crimeTrend:0.20, affordability:0.20, schoolQuality:0.15, appreciation:0.20 },
 *   }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  priceFairness: 0.25,
  crimeTrend:    0.20,
  affordability: 0.20,
  schoolQuality: 0.15,
  appreciation:  0.20,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamp a value between lo and hi (inclusive). */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Piecewise-linear interpolation.
 * segments: array of [x, y] breakpoints sorted by ascending x.
 * Returns the y value corresponding to the given x.
 *
 * Example: lerp(30, [[20,100],[28,75],[36,45],[43,20],[50,0]])
 *   → finds the [28,75]→[36,45] segment, interpolates to ~73.
 */
function lerp(x, segments) {
  if (x <= segments[0][0])                    return segments[0][1];
  if (x >= segments[segments.length - 1][0])  return segments[segments.length - 1][1];

  for (let i = 1; i < segments.length; i++) {
    const [x0, y0] = segments[i - 1];
    const [x1, y1] = segments[i];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
}

// ── Factor 1: Price Fairness ──────────────────────────────────────────────────
//
// RATIONALE
//   The estimated value is treated as the true market price. A buyer paying
//   at or below that price receives full marks. Every percentage point above
//   fair value incurs a penalty because it represents immediate negative equity
//   and higher carrying costs relative to what comparable buyers pay.
//
// FORMULA
//   ratio = listPrice / estimatedValue
//
//   if ratio ≤ 1.00  → score = 100          (at or below fair value)
//   if ratio = 1.05  → score = 75           (5%  premium — noticeable)
//   if ratio = 1.10  → score = 50           (10% premium — significant risk)
//   if ratio = 1.15  → score = 25           (15% premium — overpaying)
//   if ratio ≥ 1.20  → score = 0            (20%+ — severe overpayment)
//
//   Linear slope: penalty = (ratio − 1.0) × 500
//   score = clamp(0, 100 − max(0, penalty))
//
// BOUNDARY CHECKS
//   ratio < 1.0  → always 100 (buying a discount is not penalised)
//   ratio > 1.20 → clamped to 0

function scorePriceFairness({ listPrice, estimatedValue }) {
  if (estimatedValue <= 0) return 0;

  const ratio   = listPrice / estimatedValue;
  const penalty = Math.max(0, ratio - 1.0) * 500;

  return Math.round(clamp(0, 100, 100 - penalty));
}

// ── Factor 2: Crime Trend ─────────────────────────────────────────────────────
//
// RATIONALE
//   Violent crime is weighted 6× heavier than property crime per reported
//   incident because violent offences have a qualitatively greater impact on
//   resident safety. The trend modifier captures momentum: a neighbourhood
//   in decline is treated as riskier than identical current statistics
//   in an area that is improving.
//
// FORMULA
//   Step 1 — Build a composite crime index:
//     crimeIndex = (violentPer1k × 6) + propertyPer1k
//
//   Reference points (based on FBI UCR national averages):
//     Very safe  (V=1.0, P= 8): index = 14  → base score = 86
//     National avg (V=3.7, P=20): index = 42  → base score = 58
//     Unsafe     (V=8.0, P=42): index = 90  → base score = 10
//
//   Step 2 — Normalise to base score:
//     baseScore = clamp(0, 100 − crimeIndex)
//     (Each index point linearly reduces the score by 1)
//
//   Step 3 — Apply directional trend adjustment:
//     'declining'       → +10  (improving area, forward-looking reward)
//     'stable'          →   0  (no adjustment)
//     'slight increase' →  −8  (early warning signal)
//     'increasing'      → −18  (sustained deterioration — strong penalty)
//
//   score = clamp(0, baseScore + trendAdjustment)

const TREND_ADJUSTMENTS = {
  'declining':      +10,
  'stable':           0,
  'slight increase':  -8,
  'increasing':      -18,
};

function scoreCrimeTrend({ violentPer1k, propertyPer1k, trend }) {
  // Violent crime weighted 6× heavier to reflect qualitative severity difference
  const crimeIndex = violentPer1k * 6 + propertyPer1k;
  const baseScore  = 100 - crimeIndex;
  const adjustment = TREND_ADJUSTMENTS[trend] ?? 0;

  return Math.round(clamp(0, 100, baseScore + adjustment));
}

// ── Factor 3: Affordability ───────────────────────────────────────────────────
//
// RATIONALE
//   The standard lending guidelines (28/36 rule, FHA 43% limit) are used as
//   natural breakpoints. A debt-to-income (DTI) ratio is the most direct
//   measure of whether a buyer can comfortably sustain the payments without
//   financial stress. We score PITI-only DTI (housing DTI), not total DTI.
//
// FORMULA
//   housingDTI = (monthlyPITI / grossMonthlyIncome) × 100  [as %]
//
//   Piecewise-linear score curve:
//     DTI ≤ 20%  → 100  (very comfortable — well under guideline)
//     DTI = 28%  →  75  (at conservative threshold — the "28% rule")
//     DTI = 36%  →  45  (at standard threshold — still lender-approvable)
//     DTI = 43%  →  20  (at FHA hard limit — very stretched)
//     DTI ≥ 50%  →   0  (dangerously over-leveraged)
//
//   Linear interpolation within each segment.

const AFFORDABILITY_CURVE = [
  [20, 100],
  [28,  75],
  [36,  45],
  [43,  20],
  [50,   0],
];

function scoreAffordability({ monthlyPITI, grossMonthlyIncome }) {
  if (grossMonthlyIncome <= 0) return 0;

  const dti = (monthlyPITI / grossMonthlyIncome) * 100;

  return Math.round(clamp(0, 100, lerp(dti, AFFORDABILITY_CURVE)));
}

// ── Factor 4: School Quality ──────────────────────────────────────────────────
//
// RATIONALE
//   School quality directly impacts family desirability and long-term property
//   values. The base score converts the categorical rating into a numeric
//   anchor; proximity and supply modifiers reflect real-world access to
//   those schools (a great school 3 miles away is less valuable than one
//   that is walkable).
//
// FORMULA
//   base = RATING_BASE[rating]
//     Excellent     → 90
//     Above Average → 70
//     Average       → 48
//     Below Average → 22
//
//   distancePenalty:
//     < 0.5 mi  →  0   (walkable — no penalty)
//     0.5–1 mi  →  5   (short drive / bike ride)
//     1–2 mi    → 10   (requires car most days)
//     ≥ 2 mi    → 15   (inconveniently far)
//
//   densityBonus = min(12, schoolsInRadius × 2)
//     (Up to 12 bonus points for having multiple rated schools nearby —
//     provides choice and backup options)
//
//   score = clamp(0, 100, base − distancePenalty + densityBonus)

const RATING_BASE = {
  'Excellent':     90,
  'Above Average': 70,
  'Average':       48,
  'Below Average': 22,
};

function scoreSchoolQuality({ rating, nearestMiles, schoolsInRadius }) {
  const base = RATING_BASE[rating] ?? 40;

  const distancePenalty =
    nearestMiles < 0.5 ?  0 :
    nearestMiles < 1.0 ?  5 :
    nearestMiles < 2.0 ? 10 : 15;

  // Each school in radius adds 2 points; capped at 12 to prevent over-weighting
  const densityBonus = Math.min(12, schoolsInRadius * 2);

  return Math.round(clamp(0, 100, base - distancePenalty + densityBonus));
}

// ── Factor 5: Appreciation Potential ─────────────────────────────────────────
//
// RATIONALE
//   Future appreciation depends on four independent signals. Each contributes
//   a maximum sub-score; together they sum to 100 without extra normalisation.
//   This makes it easy to reason about which signal is driving the score.
//
// FORMULA — four signals, total max = 100
//
//   ① Growth momentum (0–40 pts)
//      Measures recent price trajectory. A 10% decline → 0 pts; flat → 20 pts;
//      sustained 10%+ growth → 40 pts.
//      growthPoints = clamp(0, 40, (growth24mo + 10) × 2)
//
//      Why +10 offset? It centres zero growth at 20/40 (neutral, not bad).
//
//   ② Inventory signal (0–25 pts)
//      Low supply with rising demand predicts upward price pressure.
//      tightening=25  stable=18  slightly elevated=10  high=3
//
//   ③ Price-to-rent ratio (0–20 pts)
//      P/R < 15 indicates strong buy fundamentals relative to rental costs.
//      Above 25 the buy case is speculative.
//      ptrPoints = clamp(0, 20, (25 − priceToRent) × 2)
//
//   ④ Days on market (0–15 pts)
//      Low DOM = competitive market = upward price pressure.
//      Below 14 days = full 15 pts; penalty of 0.25 pt per extra day.
//      domPoints = clamp(0, 15, 15 − max(0, daysOnMarket − 14) × 0.25)

const INVENTORY_POINTS = {
  'tightening':       25,
  'stable':           18,
  'slightly elevated': 10,
  'high':              3,
};

function scoreAppreciation({ growth24mo, inventory, priceToRent, daysOnMarket }) {
  // ① Recent price momentum — centred so flat growth = 20/40
  const growthPoints    = clamp(0, 40, (growth24mo + 10) * 2);

  // ② Inventory signal — tabular, no interpolation needed
  const inventoryPoints = INVENTORY_POINTS[inventory] ?? 10;

  // ③ Price-to-rent fundamentals — 0 points at P/R ≥ 25
  const ptrPoints       = clamp(0, 20, (25 - priceToRent) * 2);

  // ④ Market heat via days on market — penalty starts after 14 days
  const domPoints       = clamp(0, 15, 15 - Math.max(0, daysOnMarket - 14) * 0.25);

  return Math.round(growthPoints + inventoryPoints + ptrPoints + domPoints);
}

// ── Composite ─────────────────────────────────────────────────────────────────
//
// Weighted average of all five factor scores.
// Each weight represents the relative importance of that factor in the overall
// "should I buy this home?" decision. Weights sum to 1.0.

function computeCompositeScore(breakdown) {
  const raw = Object.entries(WEIGHTS).reduce((sum, [key, w]) => {
    const factorKey = key; // e.g. 'priceFairness' maps directly to breakdown keys
    return sum + (breakdown[factorKey] ?? 0) * w;
  }, 0);
  return Math.round(clamp(0, 100, raw));
}

// ── Verdict ───────────────────────────────────────────────────────────────────

function getVerdict(score) {
  if (score >= 80) return { title: 'Strong Buy Candidate',  body: 'This property scores well across most categories. Data suggest favorable conditions for purchase at this time.' };
  if (score >= 65) return { title: 'Cautiously Positive',   body: 'Above-average profile with a few areas to watch. Consider negotiating on price and reviewing school boundary maps.' };
  if (score >= 50) return { title: 'Mixed Signals',         body: 'Balanced positives and concerns. Further due diligence is recommended before proceeding.' };
  if (score >= 35) return { title: 'Exercise Caution',      body: 'Several categories score below average. Consult local experts and verify data independently.' };
  return               { title: 'High-Risk Profile',        body: 'Multiple categories score poorly. Thorough independent research is strongly recommended.' };
}

// ── Main entry point ──────────────────────────────────────────────────────────
//
// Accepts a structured object assembled from service layer outputs.
// Returns composite score, per-factor breakdown, and weights.
//
// @param {Object} input
//   property: { listPrice, estimatedValue }
//   crime:    { violentPer1k, propertyPer1k, trend }
//   monthly:  { piti, grossMonthlyIncome }  — piti = PI + tax + insurance (not maintenance)
//   school:   { rating, nearestMiles, schoolsInRadius }
//   market:   { growth24mo, inventory, priceToRent, daysOnMarket }

function scoreHome({ property, crime, monthly, school, market }) {
  const breakdown = {
    priceFairness: scorePriceFairness({ listPrice: property.listPrice, estimatedValue: property.estimatedValue }),
    crimeTrend:    scoreCrimeTrend(crime),
    affordability: scoreAffordability({ monthlyPITI: monthly.piti, grossMonthlyIncome: monthly.grossMonthlyIncome }),
    schoolQuality: scoreSchoolQuality(school),
    appreciation:  scoreAppreciation(market),
  };

  const composite = computeCompositeScore(breakdown);

  return { composite, breakdown, weights: WEIGHTS };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  scoreHome,
  scorePriceFairness,
  scoreCrimeTrend,
  scoreAffordability,
  scoreSchoolQuality,
  scoreAppreciation,
  computeCompositeScore,
  getVerdict,
  WEIGHTS,
};
