const common = require('../../src/common');
const yr = require('../../');
const utils = yr.require('utils');
const crypto = yr.require('crypto');

function parseLine(line) {
  const indentation = line.search(/\S/);

  return {
    indentation, line: line.trim(),
    level: (indentation / 2) + 1,
    whiteSpace: ' '.repeat(indentation)
  };
}

function getElementAttributes(line) {
  const attributes = {};
  if (!line.includes(' att={{')) return attributes;

  const parsedString = line.split(' att={{')[1].split('}}')[0];
  const parse = {};

  let parseKey = '', parseValue = '', parseType = 0, changedParseType = false;
  let isString = false, shouldSplit = false, string = '';
  let lastChar, stringKey;
  for (let value of parsedString) {
    if (value === ':' && parseType === 0 && !isString) {
      parseType = 1;
      isString = false;
      changedParseType = true;
      continue;
    } else if (value === ',' && parseType === 1 && !isString) {
      parseType = 0;
      isString = false;
      changedParseType = true;
      parse[parseKey.trim()] = parseValue.trim();
      parseKey = '';
      parseValue = '';
      continue;
    }

    changedParseType = false;

    if (lastChar !== '\\' && value === '\\' && isString) {
      lastChar = value;
      continue;
    }

    if ((value === '"' || value === "'")
    && (stringKey === value || !stringKey)) {
      if (lastChar === '\\' && isString) {
        if (parseType === 0) {
          parseKey += value;
        } else if (parseType === 1) {
          parseValue += value;
        }

        lastChar = value;
        continue;
      }

      if (value === stringKey) {
        isString = false;
        stringKey = false;
        continue;
      } else if (!stringKey) {
        isString = true;
        stringKey = value;
        continue;
      }
    }

    if (parseType === 0) {
      parseKey += value;
    } else if (parseType === 1) {
      parseValue += value;
    }

    lastChar = value;
  }

  parse[parseKey.trim()] = parseValue.trim();
  parseKey = '', parseValue = '';
  return { ...attributes, ...parse };
}

function addIdToElement(line, config, elementId=false) {
  if (config.preview && !line.includes('.__') && !line.includes('.{{__')) {
    if (!elementId) elementId = '__' + crypto.generateToken(8);
    if (!line.trim().startsWith('_')) elementId = '{{' + elementId;

    let openCase, newLine = '', addedClass;
    for (let item of line.split(' ')) {
      if (item.endsWith('{{')) {
        openCase = true;
        newLine += item + ' ';
        continue;
      }

      if (item.endsWith('}}') && openCase) {
        openCase = false;
        newLine += item + ' ';
        continue;
      }

      if (!openCase && item.startsWith('.') && !addedClass) {
        addedClass = true;
        item = item.replace(/\./, `.${elementId}.`);
      }

      newLine += item + ' ';
    }

    newLine = newLine.trimEnd();
    if (!addedClass) newLine += ` .${elementId}`;
    line = newLine;
  }

  return line;
}

module.exports = function(line, sections, section, state, lineNumber, config={}) {
  if (config.ignoreHtml) return;

  if (!sections.yr[section]) sections.yr[section] = '';
  const parsedLine = parseLine(line);

  if (parsedLine.line.startsWith('//')) {
    sections.yr[section] += line + '\n';
    return;
  }

  if (parsedLine.line.endsWith('\\\\')) {
    if (state.lineBreak) {
      state.lineBreak.line = state.lineBreak.line + parsedLine.line.slice(0, -2);
    } else {
      state.lineBreak =
        { ...parsedLine, line: parsedLine.line.slice(0, -2) };
    }

    return;
  }

  if (state.lineBreak) {
    parsedLine.line = state.lineBreak.line + parsedLine.line;
    line = state.lineBreak.line + line;
    state.lineBreak = false;
  }

  if (!state.level) state.level = 0;

  let yrParsedLine = (parsedLine.line.split(' ')[0].includes('/')
  && !parsedLine.line.split(' ')[0].includes('_!') && parsedLine.line[0] === '_')
    ? parsedLine.line.replace(/_/, '_!') : parsedLine.line;

  let elementId = '__' + crypto.generateToken(8);

  if (parsedLine.line.includes('.__')) {
    elementId = '__' + parsedLine.line
      .split('.__')[1].split(' ')[0].split('.')[0];
  } else if (!parsedLine.line.trim().startsWith('_')
  && parsedLine.line.includes('.{{__')) {
    const split = parsedLine.line.split('.{{__');
    elementId = '__' + split[1];
    parsedLine.line = split[0].trimEnd();
  }

  yrParsedLine = addIdToElement(yrParsedLine, config, elementId);

  let yrIndentation = 0, ignoreYr, wildCard = '', replaceYr;
  if (state.wrapper.length > 0) {
    let wrapper = state.wrapper[state.wrapper.length - 1];

    if (parsedLine.indentation >= wrapper.reference) {
      yrIndentation = wrapper.new - wrapper.reference + 2;
      replaceYr = sections.yr[section].includes('#@#\n');
    } else {
      wrapper = state.wrapper[state.wrapper.length - 1];
      sections.yr[section] = sections.yr[section].replace(/#@#\n/, '');
      if (wrapper.wildCard) sections[section] += wrapper.wildCard + '\n';
      state.wrapper.pop();
    }
  }

  if (yrIndentation < 0) yrIndentation = 0;

  const parsedYr = parsedLine.whiteSpace
    + ' '.repeat(yrIndentation) + yrParsedLine.trim() + '\n';

  if (replaceYr) {
    sections.yr[section] = sections.yr[section]
      .replace(/#@#\n/, parsedYr + '#@#\n');
  } else {
    sections.yr[section] += parsedYr;
  }

  if (parsedLine.indentation !== -1) {
    if (parsedLine.indentation % 2 !== 0)
      throw `-1: indentation error at line ${lineNumber}` + '';
        ` (${config.name}.yr, ${config.project}):\n\n"""\n${line}\n"""`;

    if (parsedLine.level > state.level + 1)
      throw `-2: indentation error at line ${lineNumber}` + '' +
        ` (${config.name}.yr, ${config.project}):\n\n"""\n${line}\n"""`;

    if (parsedLine.level < state.level) {
      for (let j = state.layers.length; j > parsedLine.level - 1; j--) {
        if (!state.layers[j - 1]) continue;

        sections[state.layers[j - 1].section] +=
          state.layers[j - 1].whiteSpace + `</${state.layers[j - 1].tag}>\n`;

        state.layers.pop();
      }
    } else if (parsedLine.level === state.level
    && state.element && state.layers.length > 0) {
      sections[state.layers[state.layers.length - 1].section] +=
        `</${state.layers[state.layers.length - 1].tag}>\n`;

      state.layers.pop();
    }
  }

  if (state.layers.length > 0 && (state.sectionChanged
  || state.layers[state.layers.length - 1].indentation === parsedLine.indentation)) {
    for (let j = state.layers.length - 1; j >= 0; j--) {
      if (j === -1) continue;

      sections[state.layers[j].section] +=
        state.layers[j].whiteSpace + `</${state.layers[j].tag}>\n`;

      state.layers.pop();
    }
  }

  if (parsedLine.line[0] === '_') {
    const elementAttributes = getElementAttributes(parsedLine.line);
    const attSplit = parsedLine.line.split(' att={{');

    if (attSplit.length > 1)
      parsedLine.line = attSplit[0] + attSplit[1].split('}}')[1];

    const lineSplit = parsedLine.line.split(' ');

    let tag = lineSplit.shift().substring(1);
    if (tag === '') tag = 'div';

    if (tag[0] === '_') {
      tag = tag.replace(/__/, '');
      if (!tag) tag = 'div';
      wildCard += '<!--#@#-->';
    }

    let attributes = '', id = '', classes = '';
    for (let item of lineSplit) {
      if (item.startsWith('#')) {
        id = ` id="${item.substring(1)}"`;
      } else if (item.startsWith('.')) {
        let ignoreCrypto;
        if (item.includes('.__')) {
          for (let value of item.split('\.')) {
            if (value.startsWith('__')) {
              ignoreCrypto = true;
              break;
            }
          }
        }

        classes = ` class="${item.substring(1).split('.').join(' ')}"`;
      } else {
        attributes += ` ${item}`;
      }
    }

    if (tag.includes('/')) {
      const wrapper = tag.replace(/!/, '').split('/');
      wrapper[0] = utils.capitalize(wrapper[0]);
      wrapper[1] = utils.capitalize(wrapper[1]);
      const wrapperName = wrapper.join('/');

      yr.extend(wrapper, wrapperName, sections, state, { redoWrapper: true });

      let newWrapper, wrapperIndentation;
      if (!tag.includes('!')) {
        newWrapper = {
          section, reference: parsedLine.indentation + 2,
          new: parsedLine.indentation, content: '', wildCard: '',
          layers: JSON.parse(JSON.stringify(state.layers))
        };

        state.wrapper.push(newWrapper);
        wrapperIndentation = parsedLine.indentation;
      }

      if (sections.wrappers[wrapperName]) {
        elementAttributes.id = elementId;
        elementAttributes.category = wrapper[0];
        elementAttributes.option = wrapper[1];

        let attributes = [];
        try {
          attributes = sections.wrappers[wrapperName].vars.attributes;
        } catch(error) {
          console.log(wrapperName);
          console.log(sections.wrappers[wrapperName]);
          console.log(parsedLine);
          console.log(error);
          throw error;
        }

        if (!attributes) attributes = sections.vars.attributes;
        elementAttributes.attributes = attributes;

        let redone;
        try {
          redone = !sections.wrappers[wrapperName].redone;
        } catch(error) {/* pass */}

        if (sections.jsheader
        .includes(`function __${wrapperName.replace(/\//, '_')}(`)
        && !sections.wrapperjs.includes(`"id":"${elementId}"`)) {
          const wrapperjs =
            `__${wrapperName.replace(/\//, '_')}(${JSON.stringify(elementAttributes)});\n`;

          sections.wrapperjs += wrapperjs;
        }

        if (!tag.includes('!')) {
          if (sections.wrappers[wrapperName].yrwrapperbody) {
            for (let value of sections.wrappers[wrapperName]
            .yrwrapperbody.split('\n')) {
              if (value.trim() === '') continue;
              value = addIdToElement(value, config);

              if (yrIndentation % 2 !== 0) yrIndentation -= 1;
              if (newWrapper.reference % 2 !== 0) newWrapper.reference -= 1;
              if (newWrapper.new % 2 !== 0) newWrapper.new -= 1;

              value = ' '.repeat(newWrapper.reference + yrIndentation)
                + value + '\n';

              if (value.includes('___')) {
                value = value.replace(/___/, '_');
                value += '#@#\n';
                newWrapper.new = value.search(/\S/);
              }

              sections.yr[section] += value;
            }
          }

          if (sections.wrappers[wrapperName].wrapperbody) {
            const split = sections.wrappers[wrapperName].wrapperbody.split('<!--#@#-->\n');
            if (split[1]) newWrapper.wildCard = split[1];

            for (let _line of split[0].split('\n'))
              wildCard += ' '.repeat(yrIndentation) + _line + '\n';
          }
        }
      }

      tag = 'div';
      if (!classes) {
        classes = ` class="${elementId}"`;
      } else if (!classes.includes(elementId)) {
        classes = classes.split('class="').join(`class="${elementId} `);
      }
    }

    if (config.preview) {
      if (!classes) {
        classes = ` class="${elementId}"`;
      } else if (!classes.includes(elementId)) {
        classes = classes.split('class="').join(`class="${elementId} `);
      }
    }

    attributes = `${id}${classes}${attributes}`.trim();

    sections[section] += ' '.repeat(yrIndentation) + parsedLine.whiteSpace +
      `<${tag} ${attributes}>\n${wildCard}\n`;

    state.layers.push({ tag, section, ...parsedLine });
    state.element = true;
  } else {
    if (section) {
      if (section === 'header') {
        sections[section] += parsedLine.whiteSpace + parsedLine.line + '\n';
      } else {
        let attributes = '';

        if (config.preview) elementId += ' _yrtext';

        sections[section] +=
          `${parsedLine.whiteSpace}<span class="${elementId}"${attributes}>${parsedLine.line}</span>\n`;
      }
    }

    state.element = false;
  }

  state.level = parsedLine.level;
};
