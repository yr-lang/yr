const namespaces = require('../namespaces');

const parsers = {}, defaults = {}, mergers = {}, names = {};
for (let item of Object.keys(namespaces)) {
  names[namespaces[item].name] = item;

  if (namespaces[item].parser)
    parsers[namespaces[item].name] = namespaces[item].parser;

  if (namespaces[item].default || namespaces[item].default === '') {
    defaults[namespaces[item].name] = namespaces[item].default;

    if (namespaces[item].merge)
      mergers[namespaces[item].name] = namespaces[item].default;
  }
}

module.exports = {
  namespaces, tokens: Object.keys(namespaces), parsers, mergers, names,
  defaults() { return JSON.parse(JSON.stringify(defaults)); },
  parse(parser, line, sections, section, state, lineNumber, config) {
    if (line === '') return;
    const parserFn = require(`./${parser}`);
    if (!parserFn) return;
    parserFn(line, sections, section, state, lineNumber, config);
  }
};
