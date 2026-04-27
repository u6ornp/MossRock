'use strict';

const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');
const { URL } = require('url');

const SUPPORTED_HOSTS = ['zillow.com', 'redfin.com', 'realtor.com', 'trulia.com', 'homes.com', 'homesnap.com'];

// ── HTTP fetch with browser headers ──────────────────────────────────────────
// Redirects are followed manually (max 3 hops) to avoid infinite loops.

function fetchPage(targetUrl, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 3) return reject(new Error('Too many redirects'));

    let parsed;
    try { parsed = new URL(targetUrl); }
    catch (e) { return reject(new Error('Invalid URL')); }

    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control':   'no-cache',
        'Connection':      'keep-alive',
      },
      timeout: 10000,
    };

    const req = lib.request(options, (res) => {
      const { statusCode, headers } = res;

      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
        const next = headers.location.startsWith('http') ? headers.location : `${parsed.origin}${headers.location}`;
        res.resume();
        return fetchPage(next, hops + 1).then(resolve).catch(reject);
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
      res.on('end', () => resolve({ statusCode, body }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 10s')); });
    req.end();
  });
}

// ── Price extraction — three strategies in priority order ────────────────────

function tryJsonLd(html) {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    try {
      const json = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
      const items = [].concat(JSON.parse(json));      // handle array or single object
      for (const item of items) {
        // Schema.org Offer
        const raw = item?.offers?.price ?? item?.offers?.[0]?.price ?? item?.price ?? null;
        if (raw != null) {
          const n = parseFloat(String(raw).replace(/[$,\s]/g, ''));
          if (n >= 50_000 && n <= 50_000_000) return { price: Math.round(n), source: 'structured data (JSON-LD)' };
        }
      }
    } catch { /* malformed JSON — skip */ }
  }
  return null;
}

function tryMetaTags(html) {
  // Pull og:description, description, og:title, title in that order
  const candidates = [
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,400})["']/i)?.[1],
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})["']/i)?.[1],
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{0,200})["']/i)?.[1],
    html.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1],
  ];

  for (const text of candidates) {
    if (!text) continue;
    // Matches: $485,000  $1.2M  $850K
    const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(K|M)?/i);
    if (m) {
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]?.toUpperCase() === 'M') n *= 1_000_000;
      if (m[2]?.toUpperCase() === 'K') n *= 1_000;
      if (n >= 50_000 && n <= 50_000_000) return { price: Math.round(n), source: 'page meta tags' };
    }
  }
  return null;
}

function tryInlineData(html) {
  // Zillow / Redfin sometimes embed price in JSON within the page body
  // e.g.  "price":485000  or  "listPrice":"485000"
  const patterns = [
    /"listPrice"\s*:\s*"?([\d,]+)"?/i,
    /"price"\s*:\s*"?([\d,]+)"?/i,
    /"askingPrice"\s*:\s*"?([\d,]+)"?/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n >= 50_000 && n <= 50_000_000) return { price: n, source: 'page inline data' };
    }
  }
  return null;
}

function extractPrice(html) {
  return tryJsonLd(html) ?? tryMetaTags(html) ?? tryInlineData(html);
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/fetch-listing
 * Body:    { url: string }
 * Returns: { price: number, source: string }
 *       or { error: string }
 */
router.post('/', async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A listing URL is required.' });
  }

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL format.' }); }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http and https URLs are supported.' });
  }

  const allowed = SUPPORTED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
  if (!allowed) {
    return res.status(400).json({
      error: `Unsupported site. Supported: ${SUPPORTED_HOSTS.join(', ')}.`,
    });
  }

  try {
    const { statusCode, body } = await fetchPage(url);

    if (statusCode === 403 || statusCode === 429) {
      return res.status(422).json({ error: 'The listing site blocked the request. Please enter the price manually.' });
    }
    if (statusCode !== 200) {
      return res.status(422).json({ error: `Listing page returned status ${statusCode}. Try entering the price manually.` });
    }

    const result = extractPrice(body);
    if (!result) {
      return res.status(422).json({ error: 'Could not find a price on this page. Please enter it manually.' });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch the listing page.' });
  }
});

module.exports = router;
