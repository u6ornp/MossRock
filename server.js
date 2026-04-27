'use strict';

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve static assets (mortgage.html + any co-located files) from project root
app.use(express.static(__dirname));

// API routes
app.use('/api/analyze-home', require('./routes/analyzeHome'));

// Fallback: always serve mortgage.html for the root
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'mortgage.html'));
});

app.listen(PORT, () => {
  console.log(`MossRock server running → http://localhost:${PORT}`);
  console.log(`API endpoint           → POST http://localhost:${PORT}/api/analyze-home`);
});
