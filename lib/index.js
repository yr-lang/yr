#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const yr = require(path.join(__dirname, '../node'));

fs.writeFileSync(path.join(__dirname, 'cdn.json'),
  JSON.stringify(yr.tree(__dirname, { yr: true })));
