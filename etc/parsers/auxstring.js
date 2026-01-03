const common = require('../../src/common');

module.exports = function(line, sections, section, state, lineNumber, config={}) {
  if (!sections[section + 'Aux']) sections[section + 'Aux'] = '';
  sections[section + 'Aux'] += line + '\n';
};
