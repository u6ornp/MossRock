'use strict';

const { randInt } = require('../utils/rng');

/**
 * Returns seeded registry density per 100k residents within 3-mile radius.
 * In production: swap with NSOPW public API (nsopw.gov).
 * Language is intentionally neutral and non-alarmist.
 */
function getRegistryData(rng) {
  const per100k = randInt(rng, 4, 72);

  let note;
  if (per100k < 20)      note = 'Density is in the lower range compared to national averages.';
  else if (per100k < 45) note = 'Density is near the national median.';
  else                   note = 'Density is above the national average. Review public registry data directly.';

  const barPct  = Math.min(per100k / 80 * 100, 100);
  const color   = per100k < 20 ? '#3D6B4A' : per100k < 45 ? '#C9B48E' : '#C1714F';

  return { per100k, note, barPct, color };
}

module.exports = { getRegistryData };
