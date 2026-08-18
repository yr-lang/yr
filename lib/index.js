#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const yr = require(path.join(__dirname, '../node'));

const result = [];
for (let item of yr.tree(__dirname, { yr: true }))
  result.push(`${item.category ? item.category + '/' : ''}${item.option}`);

fs.writeFileSync(path.join(__dirname, 'cdn.json'), JSON.stringify(result));
