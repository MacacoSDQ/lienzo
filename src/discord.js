// Integra Lienzo en Discord de escritorio, como hacen BetterDiscord/Vencord:
// se añade una línea a discord_desktop_core/index.js que carga lienzo-core.js
// dentro de Discord. Ese archivo lee state.json y aplica el fondo/fuente en vivo.
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const inject = require('./inject');

const FLAVORS = [
  ['Discord', 'Discord.exe'],
  ['DiscordPTB', 'DiscordPTB.exe'],
  ['DiscordCanary', 'DiscordCanary.exe'],
];
const START = '// LIENZO-START';
const END = '// LIENZO-END';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cmpVersion(a, b) {
  const pa = a.replace('app-', '').split('.').map(Number);
  const pb = b.replace('app-', '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// Instalaciones de Discord encontradas (Discord, PTB, Canary)
function findInstalls() {
  const base = process.env.LOCALAPPDATA;
  if (!base) return [];
  const out = [];
  for (const [dir, exe] of FLAVORS) {
    const root = path.join(base, dir);
    const apps = safeReaddir(root)
      .filter((n) => /^app-\d/.test(n))
      .sort(cmpVersion)
      .reverse();
    if (!apps.length) continue;
    const indexes = [];
    for (const a of apps) {
      const modules = path.join(root, a, 'modules');
      for (const m of safeReaddir(modules).filter((n) => n.startsWith('discord_desktop_core'))) {
        const idx = path.join(modules, m, 'discord_desktop_core', 'index.js');
        if (fs.existsSync(idx)) indexes.push(idx);
      }
    }
    const exePath = apps.map((a) => path.join(root, a, exe)).find((p) => fs.existsSync(p));
    if (exePath) out.push({ name: exe, exe: exePath, updater: path.join(root, 'Update.exe'), indexes });
  }
  return out;
}

function stripPatch(src) {
  const re = new RegExp(`${START}[\\s\\S]*?${END}\\r?\\n?`, 'g');
  return src.replace(re, '');
}

function isRunning(name) {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], { windowsHide: true }, (err, out) =>
      resolve(!err && out.toLowerCase().includes(name.toLowerCase()))
    );
  });
}

function killProcess(name) {
  return new Promise((resolve) =>
    execFile('taskkill', ['/F', '/IM', name], { windowsHide: true }, () => resolve())
  );
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/* ---------- Código que corre dentro de Discord ---------- */

// Sube este número cuando cambie el código de coreSource:
// así Lienzo sabe que Discord tiene una versión vieja cargada y pide reiniciar.
const CORE_VERSION = 2;

function coreSource(dir) {
  return `// Lienzo: se carga dentro de Discord. Si Lienzo no está, no hace nada.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const CORE_VERSION = ${CORE_VERSION};
const DIR = ${JSON.stringify(dir)};
const STATE = path.join(DIR, 'state.json');
const HEART = path.join(DIR, 'heartbeat.json');
const INJECT_FILE = path.join(DIR, 'inject.js'); // se relee cada vez: actualizable sin reiniciar

let last = { applied: false, error: null };

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; }
}
function b64(p, diag, key) {
  try { return fs.readFileSync(p).toString('base64'); }
  catch (e) { diag[key] = String(e.code || e.message); return null; }
}
function payload(diag) {
  const s = readState();
  diag.state = !!s;
  if (!s) return { bg: null, font: null };
  diag.bgRequested = !!s.bg;
  diag.fontRequested = !!s.font;
  const bg = s.bg && b64(s.bg.path, diag, 'bgReadError');
  const font = s.font && b64(s.font.path, diag, 'fontReadError');
  diag.bgRead = !!bg;
  return {
    bg: bg ? { data: bg, mime: s.bg.mime } : null,
    font: font ? { data: font } : null,
    dim: s.dim,
    blur: s.blur,
  };
}
function isDiscordPage(w) {
  try { return /^https:\\/\\/([\\w-]+\\.)?discord(app)?\\.com\\//.test(w.webContents.getURL()); }
  catch { return false; }
}
function beat() {
  try {
    fs.writeFileSync(HEART, JSON.stringify({ pid: process.pid, at: Date.now(), core: CORE_VERSION, ...last }));
  } catch {}
}
async function apply(w) {
  if (!w || w.isDestroyed() || !isDiscordPage(w)) return;
  const diag = {};
  try {
    const src = fs.readFileSync(INJECT_FILE, 'utf8');
    const p = payload(diag);
    const result = await w.webContents.executeJavaScript('(' + src + ')(' + JSON.stringify(p) + ')', true);
    last = { applied: true, error: null, result, diag, url: w.webContents.getURL() };
  } catch (e) {
    last = { applied: false, error: String((e && e.message) || e), diag };
  }
  beat();
}
function applyAll() {
  for (const w of BrowserWindow.getAllWindows()) apply(w);
}
const hooked = new WeakSet();
function hook(w) {
  if (hooked.has(w)) return;
  hooked.add(w);
  w.webContents.on('dom-ready', () => apply(w));
}

app.on('browser-window-created', (_e, w) => hook(w));
app.whenReady().then(() => {
  BrowserWindow.getAllWindows().forEach(hook);
  applyAll();
});
fs.watchFile(STATE, { interval: 400 }, () => applyAll());
fs.watchFile(INJECT_FILE, { interval: 1000 }, () => applyAll());
setInterval(beat, 10000);
beat();
`;
}

/* ---------- Lado de Lienzo ---------- */

class DiscordBridge extends EventEmitter {
  constructor({ dir, getState }) {
    super();
    this.dir = dir;
    this.coreFile = path.join(dir, 'lienzo-core.js');
    this.stateFile = path.join(dir, 'state.json');
    this.heartFile = path.join(dir, 'heartbeat.json');
    this.getState = getState;
    this.status = 'disconnected'; // disconnected | needs-restart | launching | connected
    this.lastError = null;
    this.installs = [];
    fs.mkdirSync(dir, { recursive: true });
  }

  get exePath() {
    return this.installs[0] && this.installs[0].exe;
  }

  setStatus(s) {
    if (s !== this.status) {
      this.status = s;
      this.emit('status', s);
    }
  }

  start() {
    fs.writeFileSync(path.join(this.dir, 'inject.js'), inject.toString());
    fs.writeFileSync(this.coreFile, coreSource(this.dir));
    this.patch();
    this.reapply();
    this.tick();
    setInterval(() => this.tick(), 3000);
    setInterval(() => this.patch(), 60000); // por si Discord se actualiza
  }

  // Añade la línea de carga en todas las versiones de Discord instaladas
  patch() {
    this.installs = findInstalls();
    const line = `${START}\ntry { require(${JSON.stringify(this.coreFile)}); } catch (e) { console.error('[Lienzo]', e); }\n${END}\n`;
    let errors = 0;
    if (this.installs.length && !this.installs.some((i) => i.indexes.length)) {
      this.lastError = 'No encontré el módulo de Discord para modificar (¿Discord a medio actualizar? Ábrelo una vez y vuelve a probar).';
      return;
    }
    for (const inst of this.installs) {
      for (const idx of inst.indexes) {
        try {
          const src = fs.readFileSync(idx, 'utf8');
          if (src.includes(line)) continue;
          fs.writeFileSync(idx, line + stripPatch(src));
        } catch (e) {
          errors++;
          this.lastError = `No pude modificar Discord: ${e.message}`;
        }
      }
    }
    if (!errors && this.lastError && this.lastError.startsWith('No pude modificar')) this.lastError = null;
  }

  unpatch() {
    for (const inst of findInstalls()) {
      for (const idx of inst.indexes) {
        try {
          fs.writeFileSync(idx, stripPatch(fs.readFileSync(idx, 'utf8')));
        } catch {}
      }
    }
  }

  // Guarda la selección actual; el código dentro de Discord la detecta al momento
  reapply() {
    try {
      writeAtomic(this.stateFile, JSON.stringify({ ...this.getState(), v: Date.now() }));
    } catch (e) {
      this.lastError = e.message;
    }
  }

  readHeartbeat() {
    try {
      return JSON.parse(fs.readFileSync(this.heartFile, 'utf8'));
    } catch {
      return null;
    }
  }

  async tick() {
    const inst = this.installs[0];
    if (!inst) return this.setStatus('disconnected');
    const running = await isRunning(inst.name);
    const hb = this.readHeartbeat();
    const alive = running && hb && Date.now() - hb.at < 25000;
    const prev = JSON.stringify(this.heartbeat);
    this.heartbeat = alive ? hb : null;
    if (JSON.stringify(this.heartbeat) !== prev) this.emit('status', this.status);

    const OLD = 'Lienzo se actualizó: reinicia Discord una vez para usar la versión nueva.';
    const outdated = alive && hb.core !== CORE_VERSION;
    if (outdated) this.lastError = OLD;
    else if (this.lastError === OLD) this.lastError = null;
    if (alive && hb.error) this.lastError = `Discord: ${hb.error}`;

    if (outdated) this.setStatus('needs-restart');
    else if (alive) this.setStatus('connected');
    else if (this.status === 'launching' && Date.now() < this.launchDeadline) return;
    else this.setStatus(running ? 'needs-restart' : 'disconnected');
  }

  // Abre (o reinicia) Discord para que cargue Lienzo
  async launch() {
    this.patch();
    const inst = this.installs[0];
    if (!inst) {
      this.lastError = 'No encontré Discord instalado.';
      this.emit('status', this.status);
      return;
    }
    this.setStatus('launching');
    this.launchDeadline = Date.now() + 60000;

    if (await isRunning(inst.name)) {
      await killProcess(inst.name);
      await sleep(1500);
    }

    const child = fs.existsSync(inst.updater)
      ? spawn(inst.updater, ['--processStart', inst.name], { detached: true, stdio: 'ignore' })
      : spawn(inst.exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(inst.exe) });
    child.on('error', (e) => {
      this.lastError = `No se pudo abrir Discord: ${e.message}`;
      this.setStatus('disconnected');
    });
    child.unref();
  }
}

module.exports = { DiscordBridge, findInstalls, coreSource, CORE_VERSION };
