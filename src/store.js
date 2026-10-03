// Biblioteca de fondos/fuentes + configuración, guardadas en %APPDATA%\Lienzo
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DATA = app.getPath('userData');
const LIB = path.join(DATA, 'biblioteca');
const DIRS = {
  backgrounds: path.join(LIB, 'fondos'),
  fonts: path.join(LIB, 'fuentes'),
};
const KEY = { backgrounds: 'background', fonts: 'font' };
const EXTENSIONS = {
  backgrounds: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'],
  fonts: ['ttf', 'otf', 'woff', 'woff2'],
};
const CFG = path.join(DATA, 'config.json');

const DEFAULTS = {
  background: null,
  font: null,
  dim: 0.45,
  blur: 0,
  autoStart: true,
  port: 9223,
  firstRun: true,
};

for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });

let config = { ...DEFAULTS };
try {
  config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG, 'utf8')) };
} catch {
  /* primera vez */
}

function save() {
  fs.writeFileSync(CFG, JSON.stringify(config, null, 2));
}

const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const prettyName = (f) => f.replace(/^\d+-/, '').replace(/\.[^.]+$/, '');

function list(kind) {
  const dir = DIRS[kind];
  return fs
    .readdirSync(dir)
    .filter((f) => EXTENSIONS[kind].includes(extOf(f)))
    .map((f) => {
      const p = path.join(dir, f);
      return {
        id: f,
        name: prettyName(f),
        path: p,
        url: pathToFileURL(p).href,
        added: fs.statSync(p).mtimeMs,
      };
    })
    .sort((a, b) => b.added - a.added);
}

function get(kind, id) {
  if (!id || !DIRS[kind]) return null;
  const p = path.join(DIRS[kind], path.basename(id));
  return fs.existsSync(p) ? { id, path: p, ext: extOf(p) } : null;
}

function add(kind, files) {
  const ids = [];
  for (const src of files) {
    if (!EXTENSIONS[kind].includes(extOf(src))) continue;
    const id = `${Date.now()}${Math.floor(Math.random() * 1000)}-${path.basename(src)}`;
    fs.copyFileSync(src, path.join(DIRS[kind], id));
    ids.push(id);
  }
  return ids;
}

function remove(kind, id) {
  const item = get(kind, id);
  if (item) fs.unlinkSync(item.path);
  if (config[KEY[kind]] === id) {
    config[KEY[kind]] = null;
    save();
  }
}

function select(kind, id) {
  config[KEY[kind]] = id || null;
  save();
}

function set(key, value) {
  config[key] = value;
  save();
}

module.exports = {
  get config() {
    return config;
  },
  LIB,
  EXTENSIONS,
  list,
  get,
  add,
  remove,
  select,
  set,
};
