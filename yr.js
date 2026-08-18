const crypto = {
  generateToken(size=15, startWithNumber=false, complex=false) {
    const chars =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < size; i++)
      token += chars[Math.floor(Math.random() * chars.length)];
    return (!isNaN(parseInt(token[0])) && !startWithNumber)
      ? this.generateToken(size, startWithNumber, complex) : token;
  }
};

const utils = {
  capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
};

const common = {
  // Bug fix: was using new Array((i*2)-1).join which was designed for 'level' units,
  // but is called with raw indentation (char count). Use simple repeat instead.
  getWhiteSpace(indentation) {
    if (!indentation || indentation < 0) return '';
    return ' '.repeat(indentation);
  }
};

const namespaces = {
  '@&': { name: 'jsapp', parser: 'array', default: [], merge: true },
  '++': { name: 'wrappers', parser: 'auxstring', default: {}, merge: true },
  '+>': { name: 'wrapperheader', parser: 'html', default: '', merge: true },
  '>+': { name: 'wrapperbody', parser: 'html', default: '', merge: true },
  '><': { name: 'body', parser: 'html', default: '', merge: true },
  '@>': { name: 'jsheader', parser: 'string', default: '', merge: true },
  '@@': { name: 'js', parser: 'string', default: '', merge: true },
  '@<': { name: 'jsfooter', parser: 'string', default: '', merge: true },
  '>@': { name: 'wrapperjs', parser: 'string', default: '', merge: true },
  '<@': { name: 'wrapperjscustom', parser: 'string', default: '', merge: true },
  '@>r': { name: 'jsheaderreact', parser: 'string', default: '', merge: true },
  '@@r': { name: 'jsreact', parser: 'string', default: '', merge: true },
  '@<r': { name: 'jsfooterreact', parser: 'string', default: '', merge: true },
  '<@r': { name: 'wrapperjscustomreact', parser: 'string', default: '', merge: true },
  '""': { name: 'documentation', parser: 'string', default: '' },
  '--': { name: 'modules', parser: 'object', default: [], merge: true },
  '==': { name: 'pixel', parser: 'string', default: '', merge: true },
  '>>': { name: 'header', parser: 'html', default: '', merge: true },
  '<<': { name: 'footer', parser: 'html', default: '', merge: true },
  '<>': { name: 'scripts', parser: 'html', default: '', merge: true },
  '#>': { name: 'cssheader', parser: 'string', default: '', merge: true },
  '##': { name: 'css', parser: 'string', default: '', merge: true },
  '#<': { name: 'cssfooter', parser: 'string', default: '', merge: true },
  '>#': { name: 'wrappercss', parser: 'string', default: '', merge: true },
  '<#': { name: 'wrappercsscustom', parser: 'string', default: '', merge: true },
  '|@': { name: 'jstests', parser: 'string', default: '', merge: true },
  '||': { name: 'assert', parser: 'string', default: '', merge: true },
  '&>': { name: 'appheader', parser: 'array', default: [], merge: true },
  '&&': { name: 'app', parser: 'array', default: [], merge: true },
  '&<': { name: 'appfooter', parser: 'array', default: [], merge: true },
  '|&': { name: 'apptests', parser: 'array', default: [], merge: true },
  '%%': { name: 'macros', parser: 'auxstring', default: {}, merge: true },
  '**': { name: 'devops', parser: 'auxstring', default: [], merge: true }
};

const _parsers = {}, defaults = {}, mergers = {}, names = {};
for (let item of Object.keys(namespaces)) {
  names[namespaces[item].name] = item;
  if (namespaces[item].parser)
    _parsers[namespaces[item].name] = namespaces[item].parser;
  if (namespaces[item].default || namespaces[item].default === '') {
    defaults[namespaces[item].name] = namespaces[item].default;
    if (namespaces[item].merge)
      mergers[namespaces[item].name] = namespaces[item].default;
  }
}

let viewType;
function transformReact(code, sections, section, config) {
  code = module.exports.macros(sections, section);

  if (viewType === 'cdn') {
    if (!window.Babel) throw 'Babel unavailable';
    return window.Babel.transform(code, { presets: ['react'] }).code;
  }

  if (viewType === 'npm') {
    for (let item of ['react', 'react-dom']) {
      if (sections.modules.includes(item)) continue;
      sections.modules.push(item)
    }
    try {
      const esbuild = require('esbuild');
      code = "import React from 'react';\n"
        + "import ReactDOM from 'react-dom/client';\n" + code;
      const result = esbuild.buildSync({
        stdin: {
          contents: code, loader: 'jsx',
          resolveDir: config.projectPath || process.cwd()
        },
        bundle: true, write: false, format: 'iife',
        nodePaths: [path.join(__dirname, 'node_modules')]
      });
      return result.outputFiles[0].text;
    } catch (error) {
      console.log(error);
      const unresolved = error.errors
        && error.errors.some(item => item.text.startsWith('Could not resolve'));

      if (!unresolved) throw error;

      if (sections) sections.reactBuildFailed = true;
      return '';
    }
  }
}

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

  // Bug fix: only add the last key-value if parseKey is non-empty
  // (avoids adding a spurious empty key when attrs end with a trailing comma)
  if (parseKey.trim()) parse[parseKey.trim()] = parseValue.trim();
  parseKey = '', parseValue = '';
  return { ...attributes, ...parse };
}

function splitRespectingQuotes(line) {
  const tokens = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (inQuote && ch === quoteChar) {
      inQuote = false;
      quoteChar = '';
      current += ch;
    } else if (!inQuote && ch === ' ') {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function addIdToElement(line, config, elementId=false) {
  let tag = line.trim().split(' ')[0];
  if (tag.startsWith('_')) {
    tag = tag.replace(/^_/, '');
    if ((VOID_TAGS.has(tag) && !['input', 'img'].includes(tag))
    || ['title', 'script', 'style'].includes(tag)) return line;
  }
  if (config.preview && !line.includes('.__') && !line.includes('.{{__')) {
    if (!elementId) elementId = '__' + crypto.generateToken(8);
    if (!line.trim().startsWith('_')) elementId = '{{' + elementId;
    let openCase, newLine = '', addedClass, attContent = '';
    for (let item of splitRespectingQuotes(line)) {
      if (!openCase) {
        if (item.endsWith('{{')) {
          openCase = '}}';
          attContent += (attContent ? ', ' : '') + item.slice(item.indexOf('{{') + 2).trim();
          continue;
        }
      } else if (openCase === '}}') {
        if (item === '}}') {
          openCase = null;
        } else if (item.endsWith('}}')) {
          attContent += ' ' + item.slice(0, -2).trim();
          openCase = null;
        } else {
          attContent += ' ' + item;
        }
        continue;
      }
      if (!openCase && item.startsWith('.') && !addedClass) {
        addedClass = true;
        item = item.replace(/^\./, `.${elementId}.`);
      }
      newLine += item + ' ';
    }
    newLine = newLine.trimEnd();
    if (!addedClass) newLine += ` .${elementId}`;
    if (attContent) {
      // Rebuild att={{ from parsed attributes: normalize to double-quoted strings,
      // bare values for non-strings (e.g. redirect-success: / instead of '/')
      const parsedAttrs = getElementAttributes(`_ att={{ ${attContent.trim()} }}`);
      const rebuiltParts = Object.entries(parsedAttrs).map(([k, v]) => {
        const needsQuotes = /[\s,{}]/.test(v);
        return `${k}: ${needsQuotes ? `"${v}"` : v}`;
      });
      newLine += ` att={{ ${rebuiltParts.join(', ')} }}`;
    }
    line = newLine;
  }
  return line;
}

//function addIdToElement(line, config, elementId=false) {
//  let tag = line.trim().split(' ')[0];
//
//  if (tag.startsWith('_')) {
//    tag = tag.replace(/^_/, '');
//
//    if ((VOID_TAGS.has(tag) && !['input', 'img'].includes(tag))
//    || ['title', 'script', 'style'].includes(tag)) return line;
//  }
//
//  if (config.preview && !line.includes('.__') && !line.includes('.{{__')) {
//    if (!elementId) elementId = '__' + crypto.generateToken(8);
//    if (!line.trim().startsWith('_')) elementId = '{{' + elementId;
//
//    let openCase, newLine = '', addedClass, attContent = '';
//    for (let item of line.split(' ')) {
//      if (!openCase) {
//        if (item.endsWith('{{')) {
//          openCase = '}}';
//          attContent += (attContent ? ', ' : '') + item.slice(item.indexOf('{{') + 2).trim();
//          continue;
//        } else if (item.includes('="') && !item.endsWith('"')) {
//          openCase = '"';
//        } else if (item.includes("='") && !item.endsWith("'")) {
//          openCase = "'";
//        }
//      } else if (openCase === '}}') {
//        if (item === '}}') {
//          openCase = null;
//        } else if (item.endsWith('}}')) {
//          attContent += ' ' + item.slice(0, -2).trim();
//          openCase = null;
//        } else {
//          attContent += ' ' + item;
//        }
//        continue;
//      } else if (item.endsWith(openCase)) {
//        openCase = null;
//      } else if (!openCase && item.startsWith('.') && !addedClass) {
//        addedClass = true;
//        item = item.replace(/^\./, `.${elementId}.`);
//      }
//
//      newLine += item + ' ';
//    }
//
//    newLine = newLine.trimEnd();
//    if (!addedClass) newLine += ` .${elementId}`;
//    if (attContent) newLine += ` att={{ ${attContent} }}`;
//    line = newLine;
//  }
//
//  return line;
//}

//function addIdToElement(line, config, elementId=false) {
//  let tag = line.trim().split(' ')[0];
//
//  if (tag.startsWith('_')) {
//    tag = tag.replace(/^_/, '');
//
//    if ((VOID_TAGS.has(tag) && !['input', 'img'].includes(tag))
//    || ['title', 'script', 'style'].includes(tag)) return line;
//  }
//
//  if (config.preview && !line.includes('.__') && !line.includes('.{{__')) {
//    if (!elementId) elementId = '__' + crypto.generateToken(8);
//    if (!line.trim().startsWith('_')) elementId = '{{' + elementId;
//
//    let openCase, newLine = '', addedClass;
//    for (let item of line.split(' ')) {
//      if (!openCase) {
//        if (item.endsWith('{{')) {
//          openCase = '}}';
//        } else if (item.includes('="') && !item.endsWith('"')) {
//          openCase = '"';
//        } else if (item.includes("='") && !item.endsWith("'")) {
//          openCase = "'";
//        }
//      } else if (item.endsWith(openCase)) {
//        openCase = null;
//        newLine += item + ' ';
//        continue;
//      }
//
//      if (!openCase && item.startsWith('.') && !addedClass) {
//        addedClass = true;
//        item = item.replace(/^\./, `.${elementId}.`);
//      }
//
//      newLine += item + ' ';
//    }
//
//    newLine = newLine.trimEnd();
//    if (!addedClass) newLine += ` .${elementId}`;
//    line = newLine;
//  }
//
//  return line;
//}

const VOID_TAGS = new Set([
  'area','base','br','col','embed','hr','img','input',
  'link','meta','param','source','track','wbr'
]);

const parserFns = {
  array(line, sections, section, state, lineNumber, config={}) {
    if (state.sectionChanged) sections[section].push('')
    sections[section][sections[section].length - 1] += line + '\n';
  },
  auxstring(line, sections, section, state, lineNumber, config={}) {
    if (!sections[section + 'Aux']) sections[section + 'Aux'] = '';
    sections[section + 'Aux'] += line + '\n';
  },
  nosection(line, sections, section, state, lineNumber, config={}) {
    if (line.startsWith('--')) sections.modules =
      [...sections.modules, ...line.slice(2).trim().split(',').map(item => item.trim())];
  },
  string(line, sections, section, state, lineNumber, config={}) {
    sections[section] += line + '\n';
  },
  html(line, sections, section, state, lineNumber, config={}) {
    if (config.ignoreHtml && !['wrapperheader', 'header', 'footer', 'scripts'].includes(section)) return;
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
    if (!['wrapperheader', 'header', 'footer', 'scripts'].includes(section))
      yrParsedLine = addIdToElement(yrParsedLine, config, elementId);
    let yrIndentation = 0, ignoreYr, wildCard = '', replaceYr;
    // Bug fix: use while loop to close ALL wrappers that need closing (not just one)
    // A single element may need to close multiple nested wrappers at once
    while (state.wrapper.length > 0) {
      let wrapper = state.wrapper[state.wrapper.length - 1];
      if (parsedLine.indentation >= wrapper.reference) {
        yrIndentation = wrapper.new - wrapper.reference + 2;
        replaceYr = sections.yr[section].includes('#@#\n');
        break; // Still inside this wrapper, stop closing
      } else {
        sections.yr[section] = sections.yr[section].replace(/#@#\n/, '');
        // Close any layers that were opened inside this wrapper before popping it
        for (let j = state.layers.length - 1; j >= 0; j--) {
          const layer = state.layers[j];
          if (!layer) continue;
          // Only close layers that belong inside this wrapper (indentation >= wrapper.reference)
          if (layer.indentation >= wrapper.reference) {
            if (!VOID_TAGS.has(layer.tag)) sections[layer.section] +=
              layer.whiteSpace + `</${layer.tag}>\n`;
            state.layers.pop();
          } else {
            break;
          }
        }
        if (wrapper.wildCard) sections[section] += wrapper.wildCard + '\n';
        state.wrapper.pop();
        // After popping, loop again to check if we need to close more wrappers
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
        throw `-1: indentation error at line ${lineNumber}` + '' +
          ` (${config.name}.yr, ${config.project}):\n\n"""\n${line}\n"""`;
      if (parsedLine.level > state.level + 1)
        throw `-2: indentation error at line ${lineNumber}` + '' +
          ` (${config.name}.yr, ${config.project}):\n\n"""\n${line}\n"""`;
      if (parsedLine.level < state.level) {
        for (let j = state.layers.length; j > parsedLine.level - 1; j--) {
          if (!state.layers[j - 1]) continue;
          if (!VOID_TAGS.has(state.layers[j - 1].tag)) sections[state.layers[j - 1].section] +=
            state.layers[j - 1].whiteSpace + `</${state.layers[j - 1].tag}>\n`;
          state.layers.pop();
        }
      } else if (parsedLine.level === state.level
      && state.element && state.layers.length > 0) {
        if (!VOID_TAGS.has(state.layers[state.layers.length - 1].tag)) sections[state.layers[state.layers.length - 1].section] +=
          `</${state.layers[state.layers.length - 1].tag}>\n`;
        state.layers.pop();
      }
    }
    if (state.layers.length > 0 && (state.sectionChanged
    || state.layers[state.layers.length - 1].indentation === parsedLine.indentation)) {
      for (let j = state.layers.length - 1; j >= 0; j--) {
        if (j === -1) continue;
        if (!VOID_TAGS.has(state.layers[j].tag)) sections[state.layers[j].section] +=
          state.layers[j].whiteSpace + `</${state.layers[j].tag}>\n`;
        state.layers.pop();
      }
    }
    if (parsedLine.line[0] === '_') {
      const elementAttributes = getElementAttributes(parsedLine.line);
      let attSplit = parsedLine.line.split(' att={{');
      while (attSplit.length > 1) {
        parsedLine.line = attSplit[0] + attSplit[1].split('}}')[1];
        attSplit = parsedLine.line.split(' att={{');
      }
      const lineSplit = splitRespectingQuotes(parsedLine.line);
      let tag = lineSplit.shift().substring(1);
      if (tag === '') tag = 'div';
      if (tag[0] === '_') {
        tag = tag.replace(/__/, '');
        if (!tag) tag = 'div';
        if (!config.simple) wildCard += '<!--#@#-->';
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
      if (tag.includes('/') && config.simple) {
        const wrapper = '___' + tag.replace(/!/, '').replace(/\//, '__');
        tag = 'div';
        if (!classes) {
          classes = ` class="${elementId} ${wrapper}"`;
        } else if (!classes.includes(elementId)) {
          classes = classes.split('class="').join(`class="${elementId} ${wrapper} `);
        }
      } else if (tag.includes('/') && !config.simple) {
        const wrapper = tag.replace(/!/, '').split('/');
        wrapper[0] = utils.capitalize(wrapper[0]);
        wrapper[1] = utils.capitalize(wrapper[1]);
        const wrapperName = wrapper.join('/');
        core.extend(wrapper, wrapperName, sections, state, {
          redoWrapper: true, simple: config.simple,
          ignoreHtml: config.ignoreHtml
        });
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
        // Always set up element attributes for wrapperjs call,
        // even if wrapper has no ++ section (no wrapperbody)
        elementAttributes.id = elementId;
        elementAttributes.category = wrapper[0];
        elementAttributes.option = wrapper[1];
        let attributes = [];
        try {
          attributes = sections.wrappers[wrapperName]
            ? sections.wrappers[wrapperName].vars.attributes
            : sections.vars.attributes;
        } catch(error) {/* pass */}
        if (!attributes) attributes = sections.vars.attributes;
        elementAttributes.attributes = attributes;
        // Call the JS wrapper function if it exists, regardless of whether ++ is present
        if (sections.jsheader
        .includes(`function __${wrapperName.replace(/\//, '_')}(`)
        && !sections.wrapperjs.includes(`"id":"${elementId}"`)) {
          const wrapperjs =
            `__${wrapperName.replace(/\//, '_')}(${JSON.stringify(elementAttributes)});\n`;
          sections.wrapperjs += wrapperjs;
        }
        if (sections.wrappers[wrapperName]) {
          if (!tag.includes('!')) {
            if (sections.wrappers[wrapperName].yrwrapperbody) {
              for (let value of sections.wrappers[wrapperName]
              .yrwrapperbody.split('\n')) {
                if (value.trim() === '') continue;
                const valueIndent = value.search(/\S/);
                const valueWhiteSpace = value.slice(0, valueIndent);
                value = valueWhiteSpace + addIdToElement(value.trim(), config);
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
      if (config.preview && !['wrapperheader', 'header', 'footer', 'scripts'].includes(section)) {
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
        if (section === 'header' || section === 'wrapperheader') {
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
  }
}

function isYrSyntax(code) {
  code = code.split('!! preview\n!! bodyblock\n!! iframeConsole\n!! element\n').join('');
  code = code.trim();

  for (let item of [...Object.keys(namespaces), '!!', '[[', '--'])
    if (code.startsWith(item)) return true;

  return false;
}

const parsers = {
  namespaces, tokens: Object.keys(namespaces),
  parsers: _parsers, mergers, names,
  defaults() { return JSON.parse(JSON.stringify(defaults)); },
  parse(parser, line, sections, section, state, lineNumber, config) {
    if (line === '') return;
    const parserFn = parserFns[parser];
    if (!parserFn) return;
    parserFn(line, sections, section, state, lineNumber, config);
  }
};

let scriptUrl, builtInLib = {};
if (typeof window !== 'undefined') {
  scriptUrl = document.currentScript?.src;
  function getWrapperName(item) {
    return (item.category && item.category !== 'yr')
      ? `${item.category}/${item.option}` : item.option;
  }
  async function setBuiltInLib() {
    const base = new URL('./lib/', scriptUrl);

    let lib = await fetch(new URL('./cdn.json', base));
    lib = await lib.json();
    console.log(0, lib);
    for (let item of lib) {
      console.log(1, item);
      const wrapperName = getWrapperName(item);
      console.log(2, wrapperName);
      delete item.isDir;
      const res = await fetch(new URL(`./${wrapperName}.yr`, base));
      console.log(3, res);
      item.yr = await res.text()
      console.log(100000, item);
      //item.output = core.parse(item.yr);
      builtInLib[wrapperName] = item;
      console.log(4, builtInLib);
    }
  }
  setBuiltInLib();
  console.log(111, builtInLib);
}

const core = {
  set(libFn) { this.lib = libFn },
  lib(category=false, option=false, parseConfig=false) {
    console.log(1);
    if (typeof window !== 'undefined') {
      return builtInLib;
    }

    return { yr: '++\n\n_' };
  },
  macros(sections, key, obfuscate=false) {
    if (key === 'yr' || !sections[key]) return sections[key];
    const currentMacros = [];
    let parsedCode = '';

    for (let line of sections[key].split('\n')) {
      if (line === '') continue;

      if (line.trim() === '@}') {
        const currentMacro = currentMacros[currentMacros.length - 1];

        if (!currentMacro) {
          console.log(-1, 'error', key, sections[key]);
          console.log(-2, 'error', sections.macros);
          console.log(-3, currentMacros);
          console.log(-4, sections.extensions);
          throw 'macro called but not required, verify your files';
        }

        const macro = sections.macros[currentMacro.name];
        let newMacro = macro.content + '\n';

        for (let index in macro.variables) {
          let variable = currentMacro.variables[index];

          if (!variable) {
            variable = (macro.variables[index].includes('='))
              ? macro.variables[index].split('=')[1] : 'false';
          }

          newMacro = newMacro
            .split(macro.variables[index].split('=')[0]).join(variable);
        }

        newMacro = (newMacro.includes('___'))
          ? newMacro.split('___').join(currentMacro.content)
          : newMacro + '\n' + currentMacro.content + '\n';

        if (currentMacros.length > 1) {
          currentMacros[currentMacros.length - 2].content += '\n' + newMacro;
        } else {
          parsedCode += '\n' + newMacro;
        }

        currentMacros.pop();
      } else if (line.trim().startsWith('_@')) {
        line = line.replace(/ /g, '');

        const name = line.split('(')[0];
        if (!Object.keys(sections.macros).includes(name)) continue;

        let variables = line.split(`${name}(`)[1].slice(0, -2).split(',');
        if (variables.length === 1 && variables[0] === '') variables = [];

        currentMacros.push({ content: '', variables, name });

        if (line.trim().endsWith(')') || line.trim().endsWith(');')) {
          const currentMacro = currentMacros[currentMacros.length - 1];

          if (!currentMacro) {
            console.log(-3, 'error', sections[key]);
            console.log(-4, 'error', sections.macros);
            throw 'macro called but not required, verify your files';
          }

          const macro = sections.macros[currentMacro.name];
          let newMacro = macro.content + '\n';

          for (let index in macro.variables) {
            let variable = currentMacro.variables[index];

            if (!variable) {
              variable = (macro.variables[index].includes('='))
                ? macro.variables[index].split('=')[1] : 'false';
            }

            newMacro = newMacro
              .split(macro.variables[index].split('=')[0]).join(variable);
          }

          newMacro = (newMacro.includes('___'))
            ? newMacro.split('___').join(currentMacro.content)
            : newMacro + '\n' + currentMacro.content + '\n';

          if (currentMacros.length > 1) {
            currentMacros[currentMacros.length - 2].content += '\n' + newMacro;
          } else {
            parsedCode += '\n' + newMacro;
          }

          currentMacros.pop();
        }
      } else if (currentMacros.length > 0) {
        currentMacros[currentMacros.length - 1].content += line + '\n';
      } else {
        parsedCode += line + '\n';
      }
    }

    sections[key] = parsedCode;
    if (obfuscate) sections[key] = sections[key];//obfuscator.obfuscate(sections[key]);
    return sections[key];
  },
  aux(sections, extension) {
    if (extension.devopsAux) {
      let counter = 0, devopsSection;
      for (let line of extension.devopsAux.split('\n')) {
        if (counter === 0) {
          counter = 1;
          sections.devops.push({});
        }

        if (line.startsWith('___')) {
          devopsSection = line.substring(3);
          counter = 0;
          continue;
        }

        if (!devopsSection) devopsSection = 'build';

        if (!sections.devops[sections.devops.length - 1][devopsSection])
          sections.devops[sections.devops.length - 1][devopsSection] = '';

        sections.devops[sections.devops.length - 1][devopsSection] +=
          line + '\n';
      }
    }

    if (extension.macrosAux) {
      let counter = 0, macro = false;
      for (let line of extension.macrosAux.split('\n')) {
        if (line === '@}') {
          if (counter === 1) {
            counter = 0;
            macro = false;
            continue;
          }

          counter--;
        }

        if (line.startsWith('_@') && line.endsWith('{')) {
          counter++;

          if (counter === 1) {
            line = line.replace(/ /g, '');
            const name = line.split('(')[0];
            let variables = line.split(`${name}(`)[1].slice(0, -2).split(',');
            if (variables.length === 1 && variables[0] === '') variables = [];
            sections.macros[name] = { content: '', variables };
            macro = name;
            continue;
          }
        }

        if (macro) sections.macros[macro].content += line + '\n';
      }
    }
  },
  extend(wrapper, wrapperName, sections, state, config={}) {
    if (config.simple && !wrapperName.includes('@')) return;

    if (!sections.parsedyr)
      sections.parsedyr = { header: '', body: '', footer: '', scripts: '' };

    try {
      if (wrapperName.startsWith('!')) {
        wrapper[0] = wrapper[0].replace(/!/, '');
        wrapper[1] = wrapper[1].replace(/!/, '');
        wrapperName = wrapperName.replace(/!/, '');
        config.ignoreHtml = true;
        sections.wrappers[wrapperName] = sections.wrappers[wrapperName] || {};
        sections.wrappers[wrapperName].owned = true;
      }

      if (!sections.wrapperjs) sections.wrapperjs = '';

      if (sections.extensions.includes('!! ' + wrapperName +  '\n')) {
        if (config.redoWrapper) {
          const newWrapper = this.parse(`>+\n\n_${wrapperName.toLowerCase()}`, {
            ignoreHtml: config.ignoreHtml
          });

          sections.wrappers[wrapperName] = newWrapper.wrappers[wrapperName];
          sections.wrappers[wrapperName].redone = true;
          sections.wrapperjs = newWrapper.wrapperjs + sections.wrapperjs;
        }

        return;
      }

      // Bug fix: register extension BEFORE parsing its content
      // to prevent infinite recursion when a wrapper imports itself via !!
      sections.extensions += '!! ' + wrapperName + '\n';

      const _yr = sections.yr;
      sections.yr = {};

      const aux = {};
      for (let item of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
        aux[item] = sections[item];
        sections[item] = '';
      }

      const result = this.parse(this.lib(wrapper[0], wrapper[1]).yr, {
        sections, wrapper: `${wrapper.join('/')}`, ...config
      });

        if (!sections.wrappers[wrapperName])
          sections.wrappers[wrapperName] = {};

        if (!sections.wrappers[wrapperName].parsed)
          sections.wrappers[wrapperName].parsed = {};

        if (!sections.wrappers[wrapperName].vars)
          sections.wrappers[wrapperName].vars = {};

      for (let item of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
        sections.wrappers[wrapperName].parsed[item] = result[item];
        sections[item] = aux[item];
      }

      try {
        sections.wrappers[wrapperName].yr = result.yr;
      } catch(error) {/* pass */}

      sections.yr = _yr;
    } catch(error) {
      console.log(-323, error);
      throw `error -323. Invalid extension: ${wrapper.join('/')}`;
    }
  },
  parse(code, config={}) {
    if (config.opposite) {
      const file = code;
      const isProject = config.isProject;
      let yrResult = isProject ? '' : '!! @wrapper\n\n';

      const VOID_TAGS = new Set([
        'area','base','br','col','embed','hr','img','input',
        'link','meta','param','source','track','wbr'
      ]);

      const P_BREAKERS = new Set([
        'address','article','aside','blockquote','div','dl',
        'fieldset','footer','form','h1','h2','h3','h4','h5','h6',
        'header','hr','main','nav','ol','p','pre','section','table','ul'
      ]);

      function tokenize(html) {
        const tokens = [];
        let i = 0;

        while (i < html.length) {
          if (html[i] === '<') {
            const close = html.indexOf('>', i);
            if (close === -1) break;

            tokens.push({
              type: 'tag',
              value: html.slice(i, close + 1)
            });

            i = close + 1;
          } else {
            const next = html.indexOf('<', i);
            tokens.push({
              type: 'text',
              value: html.slice(i, next === -1 ? html.length : next)
            });
            i = next === -1 ? html.length : next;
          }
        }

        return tokens;
      }

      function parseTag(str) {
        const isClosing = /^<\//.test(str);
        const isSelfClosing = /\/>$/.test(str);

        const nameMatch = str.match(/^<\/?([a-zA-Z0-9-]+)/);
        if (!nameMatch) return null;

        const tag = nameMatch[1].toLowerCase();

        const attrs = {};
        [...str.matchAll(/([\w-:]+)(?:="([^"]*)")?/g)].forEach(m => {
          const key = m[1];
          if (key === tag) return;
          attrs[key] = m[2] ?? true;
        });

        return { tag, attrs, isClosing, isSelfClosing };
      }

      function parseHTML(html) {
        const tokens = tokenize(html);

        const root = { tag: '_root', children: [] };
        const stack = [root];

        for (let t of tokens) {
          let current = stack[stack.length - 1];

          if (t.type === 'text') {
            const text = t.value.trim();
            if (text) current.children.push({ text });
            continue;
          }

          const parsed = parseTag(t.value);
          if (!parsed) continue;

          const { tag, attrs, isClosing, isSelfClosing } = parsed;

          if (isClosing) {
            while (stack.length > 1) {
              const top = stack.pop();
              if (top.tag === tag) break;
            }
            continue;
          }

          if (current.tag === 'p' && P_BREAKERS.has(tag)) {
            stack.pop();
            current = stack[stack.length - 1];
          }

          const node = { tag, attrs, children: [] };
          current.children.push(node);

          if (!isSelfClosing && !VOID_TAGS.has(tag)) {
            stack.push(node);
          }
        }

        return root.children;
      }

      function toYr(nodes, indent = 0) {
        let out = '';

        for (let node of nodes) {
          const space = ' '.repeat(indent);

          if (node.text) {
            let text = node.text;

            if (text.trimStart().startsWith('//')) {
              text = text.replace(/^(\s*)\/\//, (_, spaces) => {
                return spaces + '&#47;&#47;';
              });
            }

            if (text.trimStart().startsWith('_')) {
              text = text.replace(/^(\s*)_/, (_, spaces) => {
                return spaces + '&#95;';
              });
            }

            if (text.trimStart().startsWith('.')) {
              text = text.replace(/^(\s*)\./, (_, spaces) => {
                return spaces + '&#46;';
              });
            }

            out += `${space}${text}\n`;
            continue;
          }

          if (node.tag === 'script') continue;

          let line = '_';

          if (node.tag !== 'div') line += node.tag;

          if (node.attrs?.id) line += ` #${node.attrs.id}`;

          if (node.attrs?.class) {
            const cls = node.attrs.class.split(' ').join('.');
            line += ` .${cls}`;
          }

          for (let key in node.attrs) {
            if (key === 'class' || key === 'id') continue;

            if (node.attrs[key] === true) {
              line += ` ${key}`;
            } else {
              line += ` ${key}="${node.attrs[key]}"`;
            }
          }

          out += `${space}${line}\n`;

          if (node.children?.length) {
            out += toYr(node.children, indent + 2);
          }
        }

        return out;
      }

      function extract(tag, str) {
        const match = str.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return match ? match[1].trim() : '';
      }

      function formatCSS(css) {
        if (!css) return '';
        const comments = [];
        let normalized = css.replace(/\/\*[\s\S]*?\*\//g, m => {
          const idx = comments.length;
          comments.push(m);
          return `__COMMENT_${idx}__`;
        });

        normalized = normalized
          .replace(/\s*\{\s*/g, ' {')
          .replace(/\s*\}\s*/g, ' }')
          .replace(/\s*;\s*/g, '; ')
          .replace(/,\s*/g, ', ')
          //.replace(/([\w-])\s*:\s*(?!:)/g, '$1: ')
          .replace(/\s+/g, ' ')
          .replace(/__COMMENT_(\d+)__/g, (_, i) => '\n' + comments[+i] + '\n')
          .trim();

        let indent = 0;
        let out = '';
        let i = 0;

        while (i < normalized.length) {
          const char = normalized[i];

          if (char === '{') {
            out = out.trimEnd();
            out += ' {\n';
            indent++;
            out += '  '.repeat(indent);
          } else if (char === '}') {
            indent--;
            out = out.trimEnd();
            out += '\n' + '  '.repeat(indent) + '}\n';
            if (indent >= 0) out += '\n' + '  '.repeat(indent);
          } else if (char === ';') {
            out = out.trimEnd();
            out += ';\n' + '  '.repeat(indent);
          } else if (char === ' ' && out.endsWith('\n' + '  '.repeat(indent))) {
          } else {
            out += char;
          }

          i++;
        }

        return out
          .split('\n')
          .map(l => l.trimEnd())
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }

      function wrapScript(js) {
        if (!js) return '';
        let category = '';
        let option = '';

        const match = js.match(/__([A-Za-z0-9]+)_([A-Za-z0-9]+)/);
        if (match) {
          category = match[1];
          option = match[2];
        }

        const startBlock =
`async function __${category}_${option}(_config) {
    let element = (_config.id === 'body') ? document.body
      : document.querySelector(\`.\${_config.id}\`);
    if (!element) return;
    try {
      element._config = _config;
      if (window.__preview) {
        element._html = element.outerHTML;
        element._refresh = () => {
          element.outerHTML = element._html;
          __Triggers_Disclaimermodal(_config)
        };
      }
      `;

        js = js.replace(startBlock, `_@wrapper(${category}, ${option}) {\n`);

        const catchBlock = `
    } catch(error) {
      if (window.__preview || false) {
        //element.innerHTML = '<div style="background: red; color: white">'
          //+ \`${category} ${option} error: \${error.message}</div>\`;
        console.error(error);
      }
    }
  }`;

        js = js.replace(catchBlock, '\n@}');
        return js;
      }

      const tree = parseHTML(file);

      const headContent = extract('head', file);
      const bodyContent = extract('body', file);
      const styleContent = extract('style', headContent);
      const scriptContent = extract('script', bodyContent);

      function removeTags(nodes, blacklist = ['style', 'script']) {
        return nodes
          .filter(n => !n.tag || !blacklist.includes(n.tag))
          .map(n => ({
            ...n,
            children: n.children ? removeTags(n.children, blacklist) : []
          }));
      }

      const cleanTree = removeTags(tree);

      let headNodes = [];
      let bodyNodes = [];

      for (let n of cleanTree) {
        if (n.tag === 'html') {
          for (let c of n.children) {
            if (c.tag === 'head') headNodes = c.children;
            if (c.tag === 'body') bodyNodes = c.children;
          }
        }
      }

      yrResult += '>>\n\n' + toYr(headNodes) + '\n\n';
      yrResult += (isProject ? '<#' : '##') + '\n\n' + formatCSS(styleContent) + '\n\n';
      yrResult += (isProject ? '><' : '++') + '\n\n' + toYr(bodyNodes) + '\n\n';
      yrResult += (isProject ? '<@' : '@>') + '\n\n' + wrapScript(scriptContent) + '\n';
      return yrResult;
    }

    if (!isYrSyntax(code)) {
      const sections = { parsedhtml: code };

      if (config.name) sections.ui = [{
        name: (config.name.includes('.html'))
          ? config.name : `${config.name}.html`,
        content: sections.parsedhtml
      }];

      return sections;
    }

    const sections = (config.sections) ? config.sections : parsers.defaults();

    const state = {
      section: undefined, layers: [],
      lastSection: undefined, sectionChanged: false,
      wrapper: [], code
    };

    if (config.debug) {
      console.log('+++++');
      console.log(code);
      console.log('+++++');
    }

    try {
      state.id = crypto.generateToken(8);
    } catch(error) {/* pass */}

    let section = 'nosection', lineNumber = 1;

    if (!sections.vars) sections.vars = {};
    if (!sections.extensions) sections.extensions = '';

    if (config.extensions) {
      sections.extensions = [...new Set([
        ...sections.extensions.split('\n'),
        ...config.extensions.split('\n')
      ])].join('\n');
    }

    if (!sections.jsfooter) sections.jsfooter = '';
    if (!sections.wrappers) sections.wrappers = {};

    if (!sections.yr)
      sections.yr = { header: '', body: '', footer: '', scripts: '' };

    sections.wrappersAux = '';

    for (let line of code.split('\n')) {
      if (line.trim() === '') continue;

      if (parsers.tokens.includes(line)) {
        if (section === 'macros')
          this.aux(sections, { macrosAux: sections.macrosAux });

        if (section.endsWith('react')) {
          sections[section.replace(/react/, '')] +=
            transformReact(sections[section], sections, section, config) + '\n';
          sections[section] = '';
          sections.reactUsed = true;
        }

        section = parsers.namespaces[line].name;
        state.sectionChanged = true;

        // Bug fix: close ALL open wrappers when section changes, innermost first (pop, not shift)
        while (state.wrapper.length > 0) {
          const wrapper = state.wrapper[state.wrapper.length - 1];

          sections.yr[wrapper.section] =
            sections.yr[wrapper.section].replace(/#@#\n/, '');

          // Close layers created inside this wrapper
          for (let j = state.layers.length - 1; j >= 0; j--) {
            const layer = state.layers[j];
            if (!layer || layer.indentation < wrapper.reference) break;
            if (!VOID_TAGS.has(layer.tag)) sections[layer.section] +=
              layer.whiteSpace + `</${layer.tag}>\n`;
            state.layers.pop();
          }

          if (wrapper.wildCard)
            sections[wrapper.section] += wrapper.wildCard + '\n';

          state.wrapper.pop();
        }

        continue;
      }

      if (!line.startsWith('[[') && lineNumber === 1 && config.onlyVars)
        return {};

      if (line.startsWith('[[') && lineNumber === 1) {
        for (let value of line.slice(2).split(';').map(key => key.trim())) {
          const values = value.split('=');
          if (values[0] === 'attributes' && sections.vars.attributes) continue;
          sections.vars[values[0]] = JSON.parse(values[1]);
        }

        sections.varsAux = line;
        if (config.onlyVars) return sections.vars;
        continue;
      } else if (section === 'nosection') {
        if (line.startsWith('!!')) {
          const wrapperName = line.replace(/!!/g, '').trim();

          const wrapper = wrapperName.split('/');
          if (wrapper.length === 1) wrapper.unshift('__');
          console.log(1, wrapper, wrapperName, code);

          this.extend(wrapper, wrapperName, sections, state, {
            simple: config.simple, ignoreHtml: config.ignoreHtml
          });
        //} else if (line.startsWith('\\\\')) {
        //  const wrapperName = line.replace(/\\\\/g, '').trim() + '\n';

        //  if (!sections.extensions.includes(wrapperName))
        //    sections.extensions += wrapperName;
        } else if (line.startsWith('??')) {
          //let split = line.split('??');

          //for (let value of split) {
          //  value = value.trim();
          //  let split2 = value.split('::');

          //  if (split2[0].startsWith('_')) {
          //    let envVar = split2[0].substring(1).trim();
          //    let firstConditional = split2[1].trim(), secondConditional;

          //    if (split2[1].includes('?_')) {
          //      let split3 = split2[1].split('?_');
          //      firstConditional = split3[0].trim();
          //      secondConditional = split3[1].trim();
          //    }

          //    if (options.vars[envVar]) {
          //      line = firstConditional;
          //    } else if (secondConditional) {
          //      line = secondConditional;
          //    }
          //  }
          //}

          //requires = line.split(' ');
        }
      }

      let parser = (section === 'wrappers' || section === 'macros')
        ? 'auxstring' : 'nosection';

      try {
        parser = parsers.namespaces[parsers.names[section]].parser;
      } catch(error) {/* pass */}

      parsers.parse(parser, line, sections, section, state, lineNumber, config);
      state.sectionChanged = false;
      lineNumber++;
    }

    if (section.endsWith('react')) {
      sections[section.replace(/react/, '')] +=
        transformReact(sections[section], sections, section, config) + '\n';
      sections[section] = '';
      sections.reactUsed = true;
    }

    section = false;

    if (config.wrapper && sections.wrappersAux
    && !sections.wrappers[config.wrapper]) {
      const yrAux = JSON.parse(JSON.stringify(sections.yr));

      const wrapperbody = (sections.wrapperbody)
        ? sections.wrapperbody : '';

      sections.wrapperbody = '';
      sections.yr = false;

      sections.wrappers[config.wrapper] = {
        wrapper: sections.wrappersAux, vars: {}
      };

      const aux = {};
      for (let item of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
        aux[item] = sections[item];
        sections[item] = '';
      }

      const extension = this.parse(`${
        (sections.varsAux) ? `${sections.varsAux}\n\n` : ''
      }>+\n\n${sections.wrappersAux}`, { sections });

      if (!sections.wrappers[config.wrapper])
        sections.wrappers[config.wrapper] = {};

      if (!sections.wrappers[config.wrapper].parsed)
        sections.wrappers[config.wrapper].parsed = {};

      if (!sections.wrappers[config.wrapper].vars)
        sections.wrappers[config.wrapper].vars = {};

      for (let item of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
        sections.wrappers[config.wrapper].parsed[item] = extension[item];
        sections[item] = aux[item]
      }

      sections.wrappers[config.wrapper].yrwrapperbody =
        extension.yr.wrapperbody;

      delete extension.yr.wrapperbody;

      sections.wrappers[config.wrapper].wrapperbody = extension.wrapperbody;
      sections.wrappers[config.wrapper].vars = extension.vars;
      sections.wrappers[config.wrapper].yr = extension.yr;
      sections.wrapperbody = wrapperbody;
      sections.yr = yrAux;
    }

    sections.wrappersAux = '';

    while (state.wrapper.length > 0) {
      const wrapper = state.wrapper[state.wrapper.length - 1];

      sections.yr[wrapper.section] =
        sections.yr[wrapper.section].replace(/#@#\n/, '');

      if (wrapper.wildCard)
        sections[wrapper.section] += wrapper.wildCard + '\n';


      // Only close layers that were created INSIDE this wrapper (indentation >= wrapper.reference)
      // External layers (pre-existing before the wrapper) should NOT be closed here
      for (let j = state.layers.length - 1; j >= 0; j--) {
        const layer = state.layers[j];
        if (!layer) continue;
        if (layer.indentation < wrapper.reference) break;

        if (!VOID_TAGS.has(layer.tag)) sections[layer.section] +=
          layer.whiteSpace + `</${layer.tag}>\n`;

        state.layers.pop();
      }

      state.wrapper.pop();
    }

    for (let j = state.layers.length - 1; j >= 0; j--) {
      if (j === -1) continue;

      if (!VOID_TAGS.has(state.layers[j].tag)) sections[state.layers[j].section] +=
        common.getWhiteSpace(state.layers[j].indentation) + `</${state.layers[j].tag}>\n`;

      state.layers.pop();
    }

    this.aux(sections, {
      macrosAux: sections.macrosAux,
      devopsAux: sections.devopsAux
    });

    for (let item in parsers.mergers) {
      if (JSON.stringify(parsers.mergers[item]) === '""')
        sections[item] = this.macros(sections, item);
    }

    sections.modules = sections.modules
      .filter((item, pos, self) => self.indexOf(item) == pos);

    sections.parsedjs = (!config.preview) ? '' : 'window.__preview = true;\n';
    sections.parsedcss = '';

    for (let item of ['css', 'js']) {
      for (let value of ['header', '', 'footer']) {
        if (item === 'css' && (value === 'jsapp' || value === 'footer'))
          continue;

        let target = (value === 'jsapp') ? 'jsapp' : `${item}${value}`;

        if (sections[target] && !sections[`parsed${item}`].includes(sections[target])) {
          sections[`parsed${item}`] += sections[target]
            + ((!sections[target].endsWith('\n')) ? '\n' : '');
        }
      }
    }

    if (!sections.parsedjs.includes(sections.jsapp.join('')))
      sections.parsedjs = sections.jsapp.join('') + sections.parsedjs;

    sections.parsedapp = '';
    for (let item of ['jsapp', 'appheader', 'app', 'appfooter']) {
      if (!sections.parsedapp.includes(sections[item].join('')))
        sections.parsedapp += sections[item].join('');
    }

    sections.parsedcss += '\n' + sections.wrappercsscustom + '\n'
      + sections.wrappercss.replace(/\s*!important;/g, ';')
        .replace(/;/g, ' !important;');

    if (sections.cssfooter && !sections.parsedcss.includes(sections.cssfooter))
      sections.parsedcss += '\n' + sections.cssfooter;

    sections.parsedyr = { extensions: '' };

    for (let item of sections.extensions.split('\n')) {
      if (!item.startsWith('!! !')) item = item.replace(/!! /, '!! !');

      if (!sections.parsedyr.extensions.includes(item + '\n'))
        sections.parsedyr.extensions += item + '\n';
    }

    for (let value of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
      if (!sections[value]) sections[value] = '';
      if (!sections.yr[value]) sections.yr[value] = '';

      sections[`parsed${value}`] = sections[value];
      sections.parsedyr[value] = sections.yr[value];

      for (let item in sections.wrappers) {
        if (sections.wrappers[item].redone && value === 'body') continue;
        if (value === 'body' && sections.wrappers[item].owned) continue;

        if (!sections.wrappers[item].yr)
          sections.wrappers[item].yr = {};

        if (!sections.wrappers[item].parsed)
          sections.wrappers[item].parsed = {};

        if (!sections.wrappers[item].vars)
          sections.wrappers[item].vars = {};

        if (!sections.wrappers[item].yr[value])
          sections.wrappers[item].yr[value] = '';

        if (!sections.wrappers[item].parsed[value])
          sections.wrappers[item].parsed[value] = '';

        sections[`parsed${value}`] = sections.wrappers[item].parsed[value]
          + sections[`parsed${value}`];

        sections.parsedyr[value] = sections.wrappers[item].yr[value]
          + sections.parsedyr[value];
      }

      if (!sections[`parsed${value}`]) sections[`parsed${value}`] = '';
      if (!sections.parsedyr[value]) sections.parsedyr[value] = '';
    }

    sections.parsedyr = {
      ...sections.parsedyr,
      wrappercss: sections.wrappercss,
      wrappercsscustom: sections.wrappercsscustom,
      wrapperjs: sections.wrapperjs,
      wrapperjscustom: sections.wrapperjscustom
    };

    if (sections.parsedcss !== '')
      sections.parsedcss = this.macros(sections, 'parsedcss');

    if (config.preview) sections.parsedjs += '\n' + sections.jstests;

    if (sections.parsedjs !== '')
      sections.parsedjs = this.macros(sections, 'parsedjs');

    let newWrapperJs = '';
    const arr = sections.parsedyr.wrapperjs.split('\n');

    for (let item of arr) {
      if (!item) continue;

      let parsedItem = item.split('({');
      parsedItem.shift();
      parsedItem = parsedItem.join('({');

      parsedItem = parsedItem.split('})');
      parsedItem.pop();
      parsedItem = parsedItem.join('})');

      parsedItem = JSON.parse(`{${parsedItem}}`);

      for (let value of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
        if (sections[`parsed${value}`].includes(`${parsedItem.id}`)) {
          parsedItem.attributes = sections
            .wrappers[`${parsedItem.category}/${parsedItem.option}`].vars.attributes;

          // maybe add await here
          newWrapperJs += `  __${parsedItem.category}_${parsedItem.option}(${
            JSON.stringify(parsedItem)
          });\n`;
        }
      }
    }

    if (newWrapperJs) {
      if (!sections.parsedyr) sections.parsedyr = sections.parsedyr = {};

      if (!sections.parsedyr.body)
        sections.parsedyr.body = sections.parsedyr.body = '';

      sections.parsedjs += `(async () => {\n${
        (!/\n\s*_![^\s/]+\/[^\s/]+/.test(code)) ? newWrapperJs
          : newWrapperJs.split('\n').reverse().join('\n')
      }})();`;
    }

    if (config.preview) {
      function countCharacterOccurrences(str, char) {
        const regex = new RegExp(char, 'gi');
        const matches = str.match(regex);
        return matches ? matches.length : 0;
      }

      function parseCssToJson(css) {
        const styles = {};

        let openLevel = 0, _viewport = 'desktop', _pseudo = 'default', _referenceId;
        for (let item of css.split('\n')) {
          if (!item) continue;
          item = item.trim();

          if (item.includes('{')) {
            if (openLevel === 0 && !item.includes('@media')) {
              _viewport = 'desktop';
              const newItem = item.replace(/:+/g, ':');
              const names = newItem.split(' ')[0].split(':');
              _referenceId = names[0].replace(/\./, '');

              _pseudo = (!names[1]) ? 'default'
                : ':'.repeat(countCharacterOccurrences(item, ':')) + names[1];
            } else if (openLevel === 0) {
              if (item.includes('802px')) _viewport = 'tablet';
              if (item.includes('482px')) _viewport = 'phone';
            } else {
              const newItem = item.replace(/:+/g, ':');
              const names = newItem.split(' ')[0].split(':');
              _referenceId = names[0].replace(/\./, '');

              _pseudo = (!names[1]) ? 'default'
                : ':'.repeat(countCharacterOccurrences(item, ':')) + names[1];
            }

            openLevel++;
          } else if (item.trim() === '}') {
            openLevel--;

            if (openLevel === 0) {
              _viewport = 'desktop';
              _pseudo = 'default';
            }
          } else {
            let value = item.split(':');
            let key = value[0].trim();
            value.shift();

            value = value.join(':').replace(/\;$/, '').trim()
              .replace(/ !important/, '');

            if (!styles[_viewport]) styles[_viewport] = {};

            if (!styles[_viewport][_referenceId])
              styles[_viewport][_referenceId] = {};

            if (!styles[_viewport][_referenceId][_pseudo])
              styles[_viewport][_referenceId][_pseudo] = {};

            styles[_viewport][_referenceId][_pseudo][key] = value;
          }
        }

        return styles;
      }

      function parseJsonToCss(json) {
        let css = '';

        for (let item in json) { // viewport
          let indentation = (item === 'desktop') ? 0 : 2;

          if (item === 'tablet')
            css += '@media only screen and (max-width: 802px) {\n'

          if (item === 'phone')
            css += '@media only screen and (max-width: 482px) {\n'

          for (let value in json[item]) { // element
            for (let key in json[item][value]) { // pseudo
              css += `${' '.repeat(indentation)}${(value === 'body') ? value : '.' + value }`
                + `${(key === 'default') ? '' : key} {\n`;

              for (let option in json[item][value][key]) // selector
                css += `${' '.repeat(indentation + 2)}${option}`
                  + `: ${json[item][value][key][option]};\n`

              css += `${' '.repeat(indentation)}}\n`;
            }
          }

          if (item === 'tablet' || item === 'phone') css += '}\n';
        }

        return css;
      }

      sections.parsedyr.wrapperjs = newWrapperJs;
      //let newFullWrapperJs = '';
      //for (let value of sections.wrapperjs.split('\n').reverse())
      //  newFullWrapperJs += value + '\n';
      //sections.wrapperjs = newFullWrapperJs;

      let newExtensions = '';
      for (let item of sections.parsedyr.extensions.split('\n')) {
        if (!item.includes('/')) {
          newExtensions += item + '\n';
          continue;
        } else {
          const _item = item.split('/');
          if (_item[1][0].toLowerCase() === _item[1][0].toUpperCase()) {
            newExtensions += item + '\n';
            continue;
          }
        }

        for (let value of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
          if (sections.parsedyr[value].includes(item.replace(/!/g, '')
          .trim().toLowerCase())) {
            newExtensions += item + '\n';
            break;
          }
        }
      }

      sections.parsedyr.extensions = newExtensions;
      const parsedCss = parseCssToJson(sections.parsedyr.wrappercss);

      const newCss = {};
      for (let item in parsedCss) {
        for (let value in parsedCss[item]) {
          if (value === 'html' || value === 'body') {
            if (!newCss[item]) newCss[item] = {};
            newCss[item][value] = parsedCss[item][value];
            continue;
          }

          for (let key of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
            //if (sections.parsedyr[key].includes(`.${value}`)) {
              if (!newCss[item]) newCss[item] = {};
              newCss[item][value] = parsedCss[item][value];
              //break;
            //}
          }
        }
      }

      sections.parsedyr.wrappercss = parseJsonToCss(newCss);

      //const templateRegex = id =>
      //  new RegExp(`\\{\\{[^}]*?\\.?${id}\\b[^}]*?\\}\\}`);

      //for (let item of ['wrapperheader', 'header', 'body', 'footer', 'scripts']) {
      //  for (let value of sections.parsedyr[item].split('\n')) {
      //    const match = value.match(/(?:\.|\.\{\{)\s*(__[A-Za-z0-9_-]+)/);
      //    if (!match) continue;

      //    const elementId = match[1];
      //    let exists;

      //    for (let key of Object.keys(sections.parsedyr)) {
      //      const content = sections.parsedyr[key];

      //      if (!key.includes('wrapper')) {
      //        exists = templateRegex(elementId).test(content);
      //      } else {
      //        exists = content.includes(elementId);
      //      }

      //      if (exists) break;
      //    }

      //    if (!exists) {
      //      const newLine = value.split(match[0]).join('').trimEnd();

      //      sections.parsedyr[item] =
      //        sections.parsedyr[item].split(value).join(newLine);
      //    }
      //  }
      //}
    }

    if (sections.parsedapp !== '')
      sections.parsedapp = this.macros(sections, 'parsedapp');

    if (config.window) {
      let newjs = '';

      for (let item in config.window) newjs +=
        `window['${item}'] = ${JSON.stringify(config.window[item])};\n`;

      sections.parsedjs = newjs + sections.parsedjs;
    }

    if (config.localStorage) {
      let newjs = 'try {\n';

      for (let item in config.localStorage) {
        newjs += `  window.localStorage.setItem('${item}', ${
          JSON.stringify(config.localStorage[item])
        });\n`
      }

      newjs += '} catch(error) {/* pass */}\n';
      sections.parsedjs = newjs + sections.parsedjs;
    }

    if (sections.wrapperjscustom)
      sections.parsedjs += '\n' + sections.wrapperjscustom;

    if (sections.wrapperheader)
      sections.parsedheader += '\n' + sections.wrapperheader;

    if (!config.lang) config.lang = 'en-US';

    if (config.name) {
      const assetHash = crypto.generateToken(6).toLowerCase();
      for (let value of ['css', 'js'])
        config[`${value}name`] = `${config.name}.${assetHash}`;
    }

    if (sections.apptests.length > 0 && !sections.parsedbody.includes('class="__')) {
      sections.parsedbody += '\n<div class="__cclass"></div>';

      sections.parsedscripts = `<s` + `cript>
try {
function require(name) {
  //return window[name];
}
function setGlobal(name, item) {
  //window[name] = item;
}
${sections.parsedjs}
${sections.appheader.join('')}
${sections.apptests.join('')}
} catch(error) { console.log(error); }
</s` + `cript>`;
    }

    sections.parsedhtml = `<!DOCTYPE html>
<html lang="${config.lang}">
${sections.pixel}
<head>
${sections.parsedheader}
${(config.name) ? `  <link rel="stylesheet" href="./${config.cssname}.css">` : `  <style>\n${sections.parsedcss}\n</style>`}
${sections.reactUsed && viewType === 'cdn'
  ? '  <s' + 'cript src="https://unpkg.com/react@18/umd/react.production.min.js"></scri' + 'pt>\n' +
    '  <s' + 'cript src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></scri' + 'pt>'
  : ''}
</head>
<body style="display: none">
${sections.parsedbody}
${sections.parsedfooter}
${sections.parsedscripts}
<s` + `cript id="p` + `sj"${(config.name) ? ` src="./${config.jsname}.js">`
  : `>\n${sections.parsedjs}\n`
}</s` + `cript>
</body>
<s` + `cript>
document.addEventListener('DOMContentLoaded', () => {
  document.body.style.display = 'block';
});
</s` + `cript>
</html>`;

    if (config.name) sections.ui = [
      { name: `${config.name}.html`, content: sections.parsedhtml },
      { name: `${config.cssname}.css`, content: sections.parsedcss },
      { name: `${config.jsname}.js`, content: sections.parsedjs },
      { name: `${utils.capitalize(config.name)}_.yr`, content: code }
    ];

    return sections;
  },
  parsers
};

if (typeof module !== 'undefined' && module.exports) {
  viewType = 'npm';
  module.exports = core;
}

if (typeof window !== 'undefined' && !window.yr) {
  viewType = 'cdn';
  window.yr = core.parse.bind(core);

  //const createLog = (text) => {
  //  const parsed = parse(text);
  //  console.log(parsed);
  //  document.body.innerHTML += `<div>${text}</div>`;
  //  document.body.innerHTML += `<div>${parsed.parsedyr.body}</div>`;
  //};

  //createLog('><\n_ .teste');
}
