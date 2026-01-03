module.exports = function(line, sections, section, state, lineNumber, config={}) {
  if (line.startsWith('--')) sections.modules =
    [...sections.modules, ...line.slice(2).trim().split(',')];
}
