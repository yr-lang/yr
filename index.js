const fs = require('fs');
const vm = require('vm');
const spawn = require('child_process').spawn;
const common = require('./src/common');
const parsers = require('./etc/parsers');
const yrlib = __dirname + '/lib';

const env = {
  HOME: process.env.HOME,
  LIBS: [yrlib, process.env.HOME + '/.yrlibs'],
  BUILDS: process.env.HOME + '/.yrb'
};

fs.mkdirSync(process.env.HOME + '/.yrlibs', { recursive: true });
fs.mkdirSync(process.env.HOME + '/.yrb', { recursive: true });

function getWrapperName(item) {
  return (item.category && item.category !== 'yr')
    ? `${item.category}/${item.option}` : item.option;
}

function parsePaths(newPaths, useWildcard=false) {
  let newStrPath = [];

  for (let item of newPaths.split(',')) {
    if (!useWildcard) {
      if (item.startsWith(process.env.HOME)) item = item.replace(process.env.HOME, '~/');
      if (item.startsWith(__dirname)) item = item.replace(__dirname, './');
    } else {
      if (item.startsWith('~/')) item = item.replace(/~/, process.env.HOME);
      if (item.startsWith('./')) item = item.replace(/\./, __dirname);
    }

    newStrPath.push(item.replace(/\/\//g, '/'));
  }

  return newStrPath.join(',');;
};

module.exports = {
  env,
  mergeYrSections(sections, extensions=false) {
function _updateBlockAttributes(code, referenceId, attributes) {
  function buildAttributes(obj) {
    const list = [];
    for (const key in obj) {
      if (obj[key] != null) {
        let k = key.toString();
        let v = obj[key].toString();
        const quotesK = k.includes('"') ? "'" : '"';
        const quotesV = v.includes('"') ? "'" : '"';
        k = k.includes(",") || k.includes(" ") ? `${quotesK}${k}${quotesK}` : k;
        v = v.includes(",") || v.includes(" ") ? `${quotesV}${v}${quotesV}` : v;
        list.push(`${k}: ${v}`);
      }
    }
    return list.length ? `att={{ ${list.join(", ")} }}` : null;
  }

  const newAtt = buildAttributes(attributes);
  if (!newAtt) return code;

  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Find first token (first non-whitespace)
    let firstIdx = 0;
    while (firstIdx < line.length && /\s/.test(line[firstIdx])) firstIdx++;
    if (firstIdx >= line.length) continue;

    let tokenEnd = firstIdx;
    while (tokenEnd < line.length && !/\s/.test(line[tokenEnd])) tokenEnd++;
    const firstToken = line.slice(firstIdx, tokenEnd);

    // Validate first token
    const core = firstToken.startsWith("_!") ? firstToken.slice(2) : firstToken.slice(1);
    const slashIdx = core.indexOf("/");
    if (slashIdx <= 0 || slashIdx >= core.length - 1) continue;

    // Find the last dot-segment sequence that contains the referenceId
    const dotRegex = new RegExp(`\\.${referenceId}(?:\\.[\\w]+)*`, "g");
    let match;
    let lastDotStart = -1;
    let lastDotEnd = -1;
    while ((match = dotRegex.exec(line)) !== null) {
      lastDotStart = match.index;
      lastDotEnd = match.index + match[0].length;
    }
    if (lastDotStart === -1) continue;

    // Check for existing att={{ … }} after the lastDotEnd
    let attStart = line.indexOf("att={{", lastDotEnd);
    if (attStart >= 0) {
      // Find the matching closing }} while respecting quotes
      let iChar = attStart + 6;
      let inSingle = false, inDouble = false;
      let attEnd = -1;
      while (iChar < line.length - 1) {
        const ch = line[iChar];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === "}" && line[iChar + 1] === "}" && !inSingle && !inDouble) {
          attEnd = iChar + 2;
          break;
        }
        iChar++;
      }
      if (attEnd > attStart) {
        line = line.slice(0, attStart) + newAtt + line.slice(attEnd);
        lines[i] = line;
        continue;
      }
    }

    // Insert att={{ … }} after last dot-segment, preserving trailing spaces
    let insertPos = lastDotEnd;
    while (insertPos < line.length && /\s/.test(line[insertPos])) insertPos++;
    line = line.slice(0, lastDotEnd) + " " + newAtt + line.slice(lastDotEnd);
    lines[i] = line;
  }

  return lines.join("\n");
}

    let result = '';
    if (extensions) result += extensions + '\n';

    for (let item of ['nosection', 'extensions']) {
      if (sections[item]) {
        result += sections[item] + '\n';
        delete sections[item];
      }
    }

    for (let item of sections.wrapperjs.split('\n')) {
      if (!item) continue;
      let _config;
      try {
        _config = JSON.parse('{' + (item.split('({')[1].split('})')[0]) + '}');
      } catch(error) { continue; }
      if (!_config.attributes) continue;
      const attributes = {};
      for (let value of _config.attributes) attributes[value] = _config[value];
      sections.body = _updateBlockAttributes(sections.body, _config.id, attributes);
    }

    delete sections.wrapperjs;

    for (let item in sections)
      result += `${parsers.names[item]}\n\n${sections[item]}\n`;

    return result;
  },
  tree(dirPath, config={}, result=[]) {
    const dirs = fs.readdirSync(dirPath, 'utf8').map(item => {
      const path = `${dirPath}/${item}`;
      const isDir = fs.lstatSync(path).isDirectory();

      if ((isDir && (item === '.git' || item.includes('node_modules') || item.includes('__pycache__')))
      || (!isDir && item.endsWith('.swp'))) return false;

      if (config.dirName && item !== config.dirName
      && (isDir || (!isDir && !path.endsWith(`${config.dirName}/${item}`))))
        return false;

      if (config.filename && item !== config.filename && !isDir) return false;

      if (config.yr) {
        if (!isDir && !item.endsWith('.yr') && !config.yrCategory) return false;

        if (!isDir) {
          const result = {
            isDir, category: (config.yrCategory) ? config.yrCategory : false,
            option: item.replace(/\.yr/g, '')
          };

          if (config.yr === 'code') {
            result.yr = fs.readFileSync(path, 'utf8');
            result.vars = module.exports.parse(result.yr, { onlyVars: true });
          }

          if (config.yr === 'wrapper') {
            if (!/^[A-Z]/.test(item) || !item.endsWith('.yr')) return false;

            result.vars = module.exports
              .parse(fs.readFileSync(path, 'utf8'), { onlyVars: true });
          }

          return result;
        }

        return { isDir, path, name: item, yr: config.yr, tree: config.tree };
      }

      const result = { isDir, path, name: item, tree: config.tree };
      if (config.file && !isDir) result.file = fs.readFileSync(path, 'utf8');
      return result;
    }).sort((a, b) => {
      const multiple = (config.filesFirst) ? 0 : -1;
      return (a.isDir - b.isDir) * multiple || (b.name - a.name) * multiple;
    });

    for (let item of dirs) {
      if (!item) continue;

      if (item.isDir) {
        if (!config.onlyLibs && !config.yr) result.push(item);
        if (item.yr) config.yrCategory = item.name;
        if (fs.existsSync(`${item.path}/.yrrc`)) item.yrlib = true;
        result = this.tree(item.path, config, result);
      } else {
        if (config.onlyLibs) {
          if (item.name !== '.yrrc') continue;
          result.push(dirPath);
          break;
        } else {
          result.push(item);
        }
      }
    }

    return result;
  },
  set(newEnv) {
    for (let item of ['TREE', 'BUILDS', 'VIEWS', 'CONFIG']) {
      if (item === 'TREE') {
        env.LIBS = [yrlib];

        if (newEnv.TREE) {
          for (let value of newEnv.TREE) env.LIBS = [ ...env.LIBS,
            ...this.tree(parsePaths(value, true), {
              onlyLibs: true, filesFirst: true
            })
          ];
        }
      }

      env[item] = newEnv[item];
    }
  },
  spawn(path, args=[], callbackClose=false, log=true, exit=false, callbackData=false, callbackError=false) {
    if (args === '-k') {
      try {
        console.log('killing spawn');
        console.log(path, args);
        //path.stdin.pause();
        path.kill();
        console.log('spawn killed');
      } catch(error) { console.log(error); }

      return;
    }

    if (log) console.log('starting spawn...');

    const child = spawn(path, args, { shell: true });

    //child.stdin.on('data', function(data){
    //  console.log(data.toString());
    //});

    child.stdout.on('data', (data) => {
      data = data.toString();
      if (log) console.log(data);
      if (callbackData) callbackData(data);
    });

    child.stderr.on('data', (data) => {
      data = data.toString();
      if (log) console.log('\x1b[31m' + data + '\x1b[0m');
      if (callbackError) callbackError(data);
    });

    child.on('exit', (code, signal) => {
      if (log) console.log('finish spawn\n');
      //if (state.building === 1) {
      //  state.building = true;
      //  return this.devops(appName, deploy, log, exit);
      //}
      //state.building = false;
      if (callbackClose) callbackClose(code, signal);
      if (exit) process.exit();
    });

    return child;
  },
  build(projectName=false, config={}, viewsPaths=env.VIEWS, assetsPath=false) {
    if (!config) config = {};

    if (config.save && !projectName)
      throw "Can't save build, no project name";

    const result = {
      html: [], app: '', devops: {}, modules: [], macros: {},
      config: (config.projectConfig)
        ? config.projectConfig : require(`${env.CONFIG}/yrconfig.json`)
    };

    const projectPath = (projectName) ? `${
      (config.buildPath) ? config.buildPath : env.BUILDS
    }/${projectName}` : false;

    fs.mkdirSync(projectPath, { recursive: true });

    const views = [];
    const app = { jsapp: [], appheader: [], app: [], appfooter: [] };
    let devops = [];

    const buildWithPages = [];
    if (result.config.config.buildWith) {
      for (let value of result.config.config.buildWith) {
        let hasView;
        for (let key of views) {
          if (key.wrapper.option === utils.capitalize(value) + '_') {
            hasView = true;
            break;
          }
        }

        if (hasView) continue;

        buildWithPages.push({ wrapper: {
          category: false, option: utils.capitalize(value) + '_',
          yr: `!! &authapp\n><\n_${value.toLowerCase()}/app`
        } });
      }
    }
    if (buildWithPages.length > 0) viewsPaths.push({ pages: buildWithPages });

    for (let value of viewsPaths) {
      let pages = [], ignoreViews;

      if (value.pages) {
        pages = value.pages;
        ignoreViews = true;
      }

      if (!ignoreViews) {
        if (value.includes('/')) {
          pages = [value.split('/')[1] + '_.yr'];
          value = value.split('/')[0];
        } else { pages = this.getViews(value); }
      }

      for (let key of pages) {
        let wrapper = {}, ignoreLib;

        if (key.wrapper) {
          wrapper = key.wrapper;
          ignoreLib = true;
        }

        if (!ignoreLib)
          wrapper = this.lib(value, key.replace(/\.yr/g, ''));

        const viewName = wrapper.option.toLowerCase().replace(/_\.yr/g, '')
          .replace(/_$/, '');

        const itemName =
          `${(wrapper.category) ? wrapper.category + '/': ''}${viewName}`;

        wrapper = this.parse(wrapper.yr, {
          name: viewName, window: config.window,
          localStorage: config.localStorage
        });

        const item = { name: itemName, output: { ...wrapper } };

        for (let value of ['jsapp', 'appheader', 'app', 'appfooter']) {
          if (item.output[value])
            app[value] = [...new Set([...app[value], ...item.output[value]])];
        }

        devops = [...item.output.devops, ...devops];
        result.macros = { ...item.output.macros, ...result.macros };

        result.modules = [...new Set([
          ...item.output.modules, ...result.modules
        ])];

        views.push(item);
      }
    }

    for (let value of ['jsapp', 'appheader', 'app', 'appfooter'])
      result.app += app[value].join('');

    for (let value of devops) {
      for (let key in value) {
        if (!result.devops[key]) result.devops[key] = '';
        if (result.devops[key].includes(value[key])) continue;
        result.devops[key] += value[key];
      }
    }

    if (!fs.existsSync(`${projectPath}/.env.json`)) {
      const newEnv = JSON.parse(JSON.stringify(env));

      for (let item of ['HOME', 'LIBS', 'BUILDS', 'TREE', 'CONFIG']) {
        if (typeof newEnv[item] === 'object') {
          newEnv[item] = parsePaths(newEnv[item].join(',')).split(',');
        } else {
          newEnv[item] = parsePaths(newEnv[item]);
        }
      }

      if (projectName !== 'yrdev') newEnv.VIEWS = [];

      fs.writeFileSync(`${projectPath}/.env.json`,
        JSON.stringify(newEnv, null, 2));
    }

    result.app = `#!/usr/bin/env node
const window = {
  localStorage: {
    getItem: () => null,
    setItem: () => {},
  },
  __api: '',
};
const fs = require('fs');
const yr = require(\`\${process.env.HOME}/.yr/yr\`);
let projectPath = '${parsePaths(projectPath)}';
const _globals = [];
function parsePaths(newPaths) {
  let newStrPath = [];
  for (let item of newPaths.split(',')) {
    if (item.startsWith('~/')) item = item.replace(/~/, process.env.HOME);
    if (item.startsWith('./')) item = item.replace(/\\./, __dirname);
    newStrPath.push(item.replace(/\\/\\//g, '/'));
  }

  return newStrPath.join(',');
}
function setGlobal(name, item) {
  if (!_globals.includes(name)) {
    global[name] = item;
    _globals.push(name);
  }
}
projectPath = parsePaths(projectPath);
const _config = require(\`\${projectPath}/yrconfig.json\`);
const env = require(\`\${projectPath}/.env.json\`);
for (let item of ['HOME', 'LIBS', 'BUILDS', 'TREE', 'CONFIG']) {
  if (typeof env[item] === 'object') {
    env[item] = parsePaths(env[item].join(',')).split(',');
  } else {
    env[item] = parsePaths(env[item]);
  }
}
yr.set(env);\n` + result.app;

    result.app = this.macros(result, 'app');

    result.modules = result.modules.join(' ');
    result.devops = this.devops({
      devops, modules: result.modules
    }, projectPath)[0];

    for (let item of views) {
      const parsedHtml = item.output.ui;
      result.html.push(parsedHtml);
    }

    if (config.save) {
      let outputPaths =
        [projectPath + '/yrconfig.json', projectPath + '/actions'];

      for (let value of ['www', 'app']) {
        try {
          for (let item of fs.readdirSync(projectPath + `/${value}`))
            outputPaths.push(`${projectPath}/${value}/${item}`);
        } catch(error) {/* pass */}
      }

      for (let item of outputPaths) {
        if (item.endsWith('assets')) continue;

        try {
          fs.rmSync(item, { recursive: true });
        } catch(error) {/* pass */}
      }

      for (let item of [
        env.BUILDS, projectPath,
        `${projectPath}/www`, `${projectPath}/www/assets`,
        `${projectPath}/app`, `${projectPath}/app/assets`,
        `${projectPath}/actions`
      ]) { if (!fs.existsSync(item)) fs.mkdirSync(item, { recursive: true }); }

      fs.writeFileSync(projectPath + '/.gitignore', `*/node_modules/
*/__pycache__/
*.swp
*\:Zone.Identifier
node_modules/
__pycache__/
dist/`);

      fs.writeFileSync(projectPath + '/yrconfig.json', JSON.stringify(result.config, null, 2));
      fs.writeFileSync(projectPath + '/app/app.js', result.app);
      spawn('chmod', ['+x', projectPath + '/app/app.js']);

      let modules = '', requirements = '';
      for (let item of result.modules.split(' ')) {
        if (!item) continue;
        if (item.startsWith('pip==')) requirements += item.replace(/pip==/g, '') + '\n';
        else modules += item + ' ';
      }
      fs.writeFileSync(`${projectPath}/node_modules.txt`, modules);
      fs.writeFileSync(`${projectPath}/requirements.txt`, requirements);

      for (let item in result.devops) {
        fs.writeFileSync(`${projectPath}/actions/${item}`, result.devops[item])
        spawn('chmod', ['+x', `${projectPath}/actions/${item}`]);
      }

      for (let item of result.html) {
        for (let value of item) {
          if (value.name.endsWith('.yr')) continue;
          fs.writeFileSync(projectPath + `/www/${value.name}`, value.content);
        }
      }

      if (projectName && assetsPath) {
        for (let item of fs.readdirSync(assetsPath)) {
          if (item.startsWith(`${projectName}__`)) {
            const projectAssetsPath = `${projectPath}/www/assets/static`;

            if (!fs.existsSync(projectAssetsPath))
              fs.mkdirSync(projectAssetsPath, { recursive: true });

            fs.writeFileSync(`${projectAssetsPath}/${item}`,
              fs.readFileSync(`${assetsPath}/${item}`));
          }
        }
      }

      if (result.devops.build) {
        this.spawn(`${projectPath}/actions/build`, [], () => {
          if (config.exec) this.spawn(`${projectPath}/app/app.js`);
        });
      } else if (config.exec) {
        this.spawn(`${projectPath}/app/app.js`);
      }
    }

    return result;
  },
  actions(action, projectName, callbackClose=false, log=true, exit=false, callbackData=false, callbackError=false) {
    const projectPath = (projectName) ? `${env.BUILDS}/${projectName}` : false;
    return this.spawn(`${projectPath}/actions/${action}`, [], callbackClose, log, exit, callbackData, callbackError);
  },
  indent(code, indentation) {
    let parsedCode = '';
    for (let item of code.split('\n')) {
      if (item === '') {
        parsedCode += '\n';
        continue;
      }

      parsedCode += common.getWhiteSpace(indentation) + item + '\n';
    }

    return parsedCode;
  },
  devops(sections, projectPath=false, obfuscate=true) {
    // prevent devops from accessing files from outside env.LIB
    const parsed = {};

    const scrConfig = (lang) => {
      if (lang === 'bash') {
        return `_BUILDS=${parsePaths(env.BUILDS)}
_PROJECT_PATH=${parsePaths(projectPath)}
_CONFIG=$(cat $_PROJECT_PATH/yrconfig.json)`;
      } else if (lang.startsWith('python')) {
        return `from pathlib import Path
import json

_BUILDS = Path("${parsePaths(env.BUILDS)}").expanduser()
_PROJECT_PATH = Path("${parsePaths(projectPath)}").expanduser()

with open(_PROJECT_PATH / "yrconfig.json", "r") as f:
  _CONFIG = json.load(f)`;
      } else if (lang.startsWith('node')) {
        return `function parsePaths(newPaths) {
  let newStrPath = [];
  for (let item of newPaths.split(',')) {
    if (item.startsWith('~/')) item = item.replace(/~/, process.env.HOME);
    if (item.startsWith('./')) item = item.replace(/\\./, __dirname);
    newStrPath.push(item.replace(/\\/\\//g, '/'));
  }

  return newStrPath.join(',');
}
const _BUILDS = parsePaths('${parsePaths(env.BUILDS)}');
const _PROJECT_PATH = parsePaths('${parsePaths(projectPath)}');
const _CONFIG = require(\`\${_PROJECT_PATH}/yrconfig.json\`);`;
      }
      return '';
    };

    const newDevops = (projectPath, shebang='', addDist=false) => {
      const lang = shebang.startsWith('#!') ? shebang.replace(/#!/, '') : 'bash';
      shebang = '#!' + ((lang === 'bash') ? '/bin/' : '/usr/bin/env ') + lang;

      return `${shebang}\n${scrConfig(lang)}${(addDist && lang === 'bash') ? `
rm -r $_PROJECT_PATH/dist/
cp -r $_PROJECT_PATH/www/ $_PROJECT_PATH/dist/` : ''}\n`;
    };

    const getDefaultDevops = (name) => this.parse(fs.readFileSync(`${
      env.HOME
    }/_yrs/yrlib/%${name}.yr`, 'utf8'), { onlySections: true, ignoreYr: true }).devops[name];

    for (let item of sections.devops) {
      for (let value of Object.keys(item)) {
        if (item[value] === '\n\n') {
          delete item[value];
          continue;
        }

        const shebang = item[value].trim().split('\n')[0];
        if (shebang.startsWith('#!')) item[value] = item[value].trim().replace(shebang + '\n', '');

        if (!parsed[value]) parsed[value] =
          newDevops(projectPath, shebang, (value === 'build'));

        if (!parsed[value].includes(item[value]))
          parsed[value] += item[value] + '\n';
      }
    }

    for (let item of ['build', 'serve', 'deploy']) {
      try {
        let index = (item === 'build') ? 0 : 1;

        let wrapper = fs.readFileSync(`${yrlib}/\%${item}.yr`, 'utf8')
        const shebang = wrapper.trim().split('\n')[0];
        if (shebang.startsWith('#!')) wrapper = wrapper.trim().replace(shebang + '\n', '');

        if (!parsed[item]) parsed[item] = newDevops(projectPath, shebang, (item === 'build'))
          + this.parse(wrapper, { onlySections: true }).devops[index][item];
      } catch(error) {/* pass */}
    }

    return [parsed];
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
    if (!sections.parsedyr)
      sections.parsedyr = { header: '', body: '', footer: '', scripts: '' };

    try {
      if (wrapperName.startsWith('!')) {
        wrapper[0] = wrapper[0].replace(/!/, '');
        wrapper[1] = wrapper[1].replace(/!/, '');
        wrapperName = wrapperName.replace(/!/, '');
        config.ignoreHtml = true;
      }

      if (!sections.wrapperjs) sections.wrapperjs = '';

      if (sections.extensions.includes('!! ' + wrapperName +  '\n')) {
        if (config.redoWrapper) {
          const newWrapper = this.parse(`>+\n\n_${wrapperName.toLowerCase()}`, {
            ignoreHtml: config.ignoreHtml
          });

          sections.wrappers[wrapperName] = newWrapper.wrappers[wrapperName];
          sections.wrappers[wrapperName].redone = true;
          sections.wrapperjs += newWrapper.wrapperjs;
        }

        return;
      }

      const _yr = sections.yr;
      sections.yr = {};

      const aux = {};
      for (let item of ['header', 'body', 'footer', 'scripts']) {
        aux[item] = sections[item];
        sections[item] = '';
      }

      const result = this.parse(this.lib(wrapper[0], wrapper[1]).yr, {
        sections, wrapper: `${wrapper.join('/')}`, ...config
      });

      sections.extensions += '!! ' + wrapperName + '\n';

        if (!sections.wrappers[wrapperName])
          sections.wrappers[wrapperName] = {};

        if (!sections.wrappers[wrapperName].parsed)
          sections.wrappers[wrapperName].parsed = {};

        if (!sections.wrappers[wrapperName].vars)
          sections.wrappers[wrapperName].vars = {};

      for (let item of ['header', 'body', 'footer', 'scripts']) {
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

        section = parsers.namespaces[line].name;
        state.sectionChanged = true;

        if (state.wrapper.length > 0) {
          const wrapper = state.wrapper[0];

          sections.yr[wrapper.section] =
            sections.yr[wrapper.section].replace(/#@#\n/, '');

          if (wrapper.wildCard)
            sections[wrapper.section] += wrapper.wildCard + '\n';

          state.wrapper.shift();
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

          this.extend(wrapper, wrapperName, sections, state);
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
      for (let item of ['header', 'body', 'footer', 'scripts']) {
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

      for (let item of ['header', 'body', 'footer', 'scripts']) {
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


      for (let j = wrapper.layers.length - 1; j >= 0; j--) {
        if (j === -1) continue;

        sections[wrapper.layers[j].section] +=
          common.getWhiteSpace(wrapper.layers[j].indentation) + `</${wrapper.layers[j].tag}>\n`;

        wrapper.layers.pop();
        state.layers = state.layers.filter(e => e !== sections[wrapper.layers[j]]);
      }

      state.wrapper.pop();
    }

    for (let j = state.layers.length - 1; j >= 0; j--) {
      if (j === -1) continue;

      sections[state.layers[j].section] +=
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

    for (let value of ['header', 'body', 'footer', 'scripts']) {
      if (!sections[value]) sections[value] = '';
      if (!sections.yr[value]) sections.yr[value] = '';

      sections[`parsed${value}`] = sections[value];
      sections.parsedyr[value] = sections.yr[value];

      for (let item in sections.wrappers) {
        // fix!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
        if (sections.wrappers[item].redone) continue; // this will cause files to be parsed wrongly
        // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

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

    let newWrapperJs = '';//const __runenv = async () => {\n';
    //sections.parsedjs += 'const __runenv = async () => {\n';
    const arr = sections.parsedyr.wrapperjs.split('\n');
    if (code.includes('!! !')) arr.reverse();
    for (let item of arr) {
      if (!item) continue;

      let parsedItem = item.split('({');
      parsedItem.shift();
      parsedItem = parsedItem.join('({');

      parsedItem = parsedItem.split('})');
      parsedItem.pop();
      parsedItem = parsedItem.join('})');

      parsedItem = JSON.parse(`{${parsedItem}}`);

      for (let value of ['header', 'body', 'footer', 'scripts']) {
        if (sections[`parsed${value}`].includes(`${parsedItem.id}`)) {
          parsedItem.attributes = sections
            .wrappers[`${parsedItem.category}/${parsedItem.option}`].vars.attributes;

          const newItem = `__${parsedItem.category}_${parsedItem.option}(${
            JSON.stringify(parsedItem)
          });`;

          sections.parsedjs += newItem + '\n';
          newWrapperJs += newItem + '\n';
          break;
        }
      }
    }
    //newWrapperJs += '};\n__runenv();\n';
    //sections.parsedjs += '};\n__runenv();\n';

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

        for (let value of ['header', 'body', 'footer', 'scripts']) {
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

          for (let key of ['header', 'body', 'footer', 'scripts']) {
            //if (sections.parsedyr[key].includes(`.${value}`)) {
              if (!newCss[item]) newCss[item] = {};
              newCss[item][value] = parsedCss[item][value];
              //break;
            //}
          }
        }
      }

      sections.parsedyr.wrappercss = parseJsonToCss(newCss);

      const templateRegex = id =>
        new RegExp(`\\{\\{[^}]*?\\.?${id}\\b[^}]*?\\}\\}`);

      for (let item of ['header', 'body', 'footer', 'scripts']) {
        for (let value of sections.parsedyr[item].split('\n')) {
          const match = value.match(/(?:\.|\.\{\{)\s*(__[A-Za-z0-9_-]+)/);
          if (!match) continue;

          const elementId = match[1];
          let exists;

          for (let key of Object.keys(sections.parsedyr)) {
            const content = sections.parsedyr[key];

            if (!key.includes('wrapper')) {
              exists = templateRegex(elementId).test(content);
            } else {
              exists = content.includes(elementId);
            }

            if (exists) break;
          }

          if (!exists) {
            const newLine = value.split(match[0]).join('').trimEnd();

            sections.parsedyr[item] =
              sections.parsedyr[item].split(value).join(newLine);
          }
        }
      }
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

    if (!config.lang) config.lang = 'en-US';

    if (config.name) {
      const assetHash = crypto.generateToken(6).toLowerCase();
      for (let value of ['css', 'js'])
        config[`${value}name`] = `${config.name}.${assetHash}`;
    }

    if (sections.apptests.length > 0 && !sections.parsedbody.includes('class="__')) {
      sections.parsedbody += '\n<div class="__cclass"></div>';

      sections.parsedscripts = `<script>
try {
function require(name) {
  //return window[name];
}
function setGlobal(name, item) {
  //window[name] = item;
}
${sections.jsapp.join('')}
${sections.appheader.join('')}
${sections.apptests.join('')}
} catch(error) { console.log(error); }
</script>`;
    }

    sections.parsedhtml = `<!DOCTYPE html>
<html lang="${config.lang}">
${sections.pixel}
<head>
${sections.parsedheader}
${(config.name) ? `  <link rel="stylesheet" href="/${config.cssname}.css">` : `  <style>\n${sections.parsedcss}\n</style>`}
</head>
<body style="display: none">
${sections.parsedbody}
${sections.parsedfooter}
</body>
${sections.parsedscripts}
<script id="psj"${(config.name) ? ` src="/${config.jsname}.js">`
  : `>\n${sections.parsedjs}\n`
}</script>
<script>
document.addEventListener('DOMContentLoaded', () => {
  document.body.style.display = 'block';
});
</script>
</html>`;

    if (config.name) sections.ui = [
      { name: `${config.name}.html`, content: sections.parsedhtml },
      { name: `${config.cssname}.css`, content: sections.parsedcss },
      { name: `${config.jsname}.js`, content: sections.parsedjs },
      { name: `${utils.capitalize(config.name)}_.yr`, content: code }
    ];

    return sections;
  },
  getViews(category) {
    let views = [];

    for (let item of env.LIBS) {
      try {
        views = [...views, ...fs.readdirSync(`${item}/${category}`)
          .filter(filename => filename.endsWith('_.yr'))];
      } catch(error) {/* pass */}
    }

    return views.filter((item, pos) => views.indexOf(item) == pos);
  },
  require(wrapper) {
    const wrapperName = (!wrapper.includes('/')) ? wrapper.toLowerCase()
      : wrapper.split('/')[0].toLowerCase() + utils.capitalize(wrapper.split('/')[1]);

    const script = this.parse(`!! ${wrapper}`).jsapp.join('');

    if (!script) return {};

    const context = new vm.createContext({
      console, setTimeout, setInterval
    });

    (new vm.Script(script)).runInContext(context);
    return (context[wrapperName]) ? context[wrapperName] : context;
  },
  wrappers(category=false, option=false, libs=false, onlyLibs=false, code=false, parse=false, preview=false) {
    const wrappers = {}, categories = [];

    const treeConfig = {
      onlyLibs, filesFirst: true, yr: (!onlyLibs) ? 'wrapper' : false,
      filename: option, dirName: (category === '__') ? false : category
    };

    if ((code || parse) && !onlyLibs) treeConfig.yr = 'code';

    for (let item of (libs ? libs : env.LIBS)) {
      const result = this.tree(item, treeConfig);

      for (let value of result) {
        if (!onlyLibs) {
          const wrapperName = getWrapperName(value);
          if (wrappers[wrapperName]) continue;
          delete value.isDir;

          if (parse) {
            if (preview) value.yr = '!! preview\n' + value.yr;

            try {
              value.output = this.parse(value.yr, { preview }).parsedhtml;
            } catch(error) {
              value.output =
                `<pre>${(error.message) ? error.message : error}</pre>`;
            }

            delete value.yr;
          }

          wrappers[wrapperName] = value;
        } else {
          const split = value.split('/');
          let name = split[split.length - 1];
          if (name === 'yr') name = split[split.length - 2];
          categories.push(name);
        }
      }
    }

    return (!onlyLibs) ? wrappers : categories;
  },
  lib(category=false, option=false, parseConfig=false) {
    if (option) option += '.yr';
    const lib = {};

    for (let item of env.LIBS) {
      const result = this.tree(item, {
        filesFirst: true, yr: 'code', filename: option,
        dirName: (category === '__') ? false : category
      });

      for (let value of result) {
        const wrapperName = getWrapperName(value);
        if (lib[wrapperName]) continue;
        delete value.isDir;

        if (parseConfig) value.output = this.parse(value.yr, parseConfig);
        lib[wrapperName] = value;
      }
    }

    return (category && option) ? lib[`${
      (category === '__') ? '' : category + '/'
    }${option}`.replace(/\.yr/g, '')] : lib;
  },
  ci(category='Yrci', option=false) {
    console.log('yrCI started...\n');
    let wrappers = this.lib(category, option);
    if (category && option) wrappers = [wrappers];

    for (let item in wrappers) {
      console.log(`####### Testing [${getWrapperName(wrappers[item])}]\n`);
      const wrapper = this.parse(wrappers[item].yr, { debug: true, preview: true });
      //console.log('===================== Wrapper');
      //console.log(wrappers[item].yr);
      //console.log('===================== Parsed');
      console.log(wrapper.parsedyr.body);
      //console.log('=================== BODY assert');
      console.log(wrapper.body);
      //console.log('=================== YR assert');
      //console.log(wrappers[item].yr);
      //console.log('===================');
      //console.log('Reality: ');
      //console.log(wrapper.yr.body);
      //console.log('===================');
      //console.log('Expect: ');
      //console.log(wrapper.assert);
      //console.log('===================');
      //console.log(`Asserted: ${wrapper.yr.body === wrapper.assert}`);
      //console.log('=================== JS assert');
      //console.log(wrapper.parsedjs);

      //console.log('===================== Yr');
      //console.log(wrapper.yr);
      //console.log('===================== Merged sections');
      //const merged = this.mergeYrSections(wrapper.yr)
      //console.log(merged);
      //console.log('');
      //console.log('===================== Parsed merged');

      //console.log(this.parse(merged, {
      //  debug: true, preview: true
      //}).parsedhtml);

      //console.log(wrapper.parsedbody);
      //console.log(wrapper.yr);
      //console.log(wrapper.parsedyr);
    }

    console.log('yrCI finished');
  }
};

const utils = module.exports.require('utils');
const crypto = module.exports.require('crypto');
