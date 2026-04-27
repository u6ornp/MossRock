'use strict';

// Backward-compatibility shim.
// All scoring logic now lives in utils/scoringEngine.js.
const { computeCompositeScore, getVerdict, WEIGHTS } = require('./scoringEngine');

module.exports = { computeScore: computeCompositeScore, getVerdict, WEIGHTS };
