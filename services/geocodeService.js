'use strict';

const https = require('https');

/**
 * Census Geocoder → { city, stateAbbr, lat, lng }
 * Free, no API key required.
 * Docs: https://geocoding.geo.census.gov/geocoder/
 */
function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      address,
      benchmark:  'Public_AR_Current',
      vintage:    'Current_Current',
      format:     'json',
      layers:     '0',
    });

    const options = {
      hostname: 'geocoding.geo.census.gov',
      path:     `/geocoder/geographies/onelineaddress?${params}`,
      method:   'GET',
      headers:  { 'Accept': 'application/json' },
      timeout:  10000,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const data   = JSON.parse(body);
          const match  = data?.result?.addressMatches?.[0];
          if (!match) return reject(new Error('Address not found in Census geocoder'));

          const geo        = match.geographies?.['Census Tracts']?.[0] ?? match.geographies?.['2020 Census Blocks']?.[0];
          const coords     = match.coordinates;
          const components = match.addressComponents;

          resolve({
            city:       components?.city ?? '',
            stateAbbr:  components?.state ?? '',
            zip:        components?.zip ?? '',
            lat:        coords?.y ?? null,
            lng:        coords?.x ?? null,
            county:     geo?.COUNTY ?? '',
            stateFips:  geo?.STATE ?? '',
            tractFips:  geo?.TRACT ?? '',
            fullMatch:  match.matchedAddress,
          });
        } catch (e) {
          reject(new Error('Failed to parse geocoder response'));
        }
      });
    });

    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Geocoder timed out')); });
    req.end();
  });
}

module.exports = { geocodeAddress };
