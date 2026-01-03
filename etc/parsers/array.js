const common = require('../../src/common');

module.exports = function(line, sections, section, state, lineNumber, config={}) {
  if (state.sectionChanged) sections[section].push('')
  sections[section][sections[section].length - 1] += line + '\n';
};
