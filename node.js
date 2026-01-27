const fs = require('fs');
const vm = require('vm');
const spawn = require('child_process').spawn;
const common = require('./src/common');
const core = require('./yr');
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
      result += `${core.parsers.names[item]}\n\n${sections[item]}\n`;

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
        const appName = (value.includes(':')) ? value.split(':')[0] : value;
        const viewName = (value.includes(':')) ? value.split(':')[1] : value;

        let hasView;
        for (let key of views) {
          if (key.wrapper.option === utils.capitalize(viewName) + '_') {
            hasView = true;
            break;
          }
        }

        if (hasView) continue;

        buildWithPages.push({ wrapper: {
          category: false, option: utils.capitalize(viewName) + '_',
          yr: `!! &authapp\n><\n_${appName.toLowerCase()}/app`
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
let _PROJECT_PATH = '${parsePaths(projectPath)}';
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
_PROJECT_PATH = parsePaths(_PROJECT_PATH);
const _config = require(\`\${_PROJECT_PATH}/yrconfig.json\`);
const env = require(\`\${_PROJECT_PATH}/.env.json\`);
for (let item of ['HOME', 'LIBS', 'BUILDS', 'TREE', 'CONFIG']) {
  if (typeof env[item] === 'object') {
    env[item] = parsePaths(env[item].join(',')).split(',');
  } else {
    env[item] = parsePaths(env[item]);
  }
}\n` + result.app;

    result.app = core.macros(result, 'app');

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
          fs.writeFileSync(`${projectPath}/www/${item}`,
            fs.readFileSync(`${assetsPath}/${item}`));
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
        return `_BUILDS="${parsePaths(env.BUILDS).replace(/~/, '$HOME')}"
_PROJECT_PATH="${parsePaths(projectPath).replace(/~/, '$HOME')}"
_CONFIG=$(cat "$_PROJECT_PATH/yrconfig.json")`;
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
rm -r "$_PROJECT_PATH/dist/"
cp -r "$_PROJECT_PATH/www/" "$_PROJECT_PATH/dist/"
cp -r "$_PROJECT_PATH/static/." "$_PROJECT_PATH/dist/"` : ''}\n`;
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
  extend(wrapper, wrapperName, sections, state, config={}) {
    core.extend(wrapper, wrapperName, sections, state, config);
  },
  parse(code, config={}) {
    core.set((category=false, option=false, parseConfig=false) =>
      this.lib(category, option, parseConfig))

    return core.parse(code, config);
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
      console.log(wrapper);
      //console.log(wrappers[item].yr);
      //console.log('===================== Parsed');
      //console.log(wrapper.parsedyr.body);
      //console.log('=================== BODY assert');
      //console.log(wrapper.body);
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
