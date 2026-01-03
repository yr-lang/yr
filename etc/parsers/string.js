const common = require('../../src/common');

module.exports = function(line, sections, section, state, lineNumber, config={}) {
  sections[section] += line + '\n';
};
