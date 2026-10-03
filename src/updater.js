// Actualizaciones automáticas desde GitHub Releases (MacacoSDQ/lienzo).
// Descarga en segundo plano y avisa cuando la versión nueva está lista.
const { app } = require('electron');
const { EventEmitter } = require('events');

const CHECK_EVERY = 30 * 60 * 1000; // cada 30 minutos

function notesText(notes) {
  if (!notes) return '';
  const raw = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes);
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

class Updater extends EventEmitter {
  constructor() {
    super();
    // idle | checking | downloading | ready | error | disabled
    this.state = { status: 'idle' };
    this.au = null;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  start() {
    if (!app.isPackaged) {
      this.set({ status: 'disabled' }); // con "npm start" no se actualiza
      return;
    }
    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      if (this.state.status !== 'ready' && this.state.status !== 'downloading') this.set({ status: 'checking' });
    });
    autoUpdater.on('update-not-available', () => {
      if (this.state.status !== 'ready') this.set({ status: 'idle', error: null });
    });
    autoUpdater.on('update-available', (info) => {
      this.set({ status: 'downloading', version: info.version, percent: 0, notes: notesText(info.releaseNotes) });
    });
    autoUpdater.on('download-progress', (p) => {
      this.set({ status: 'downloading', percent: Math.round(p.percent || 0) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', version: info.version, percent: 100, notes: notesText(info.releaseNotes) || this.state.notes });
      this.emit('ready', info.version);
    });
    autoUpdater.on('error', (e) => {
      console.error('[Lienzo] update', e);
      if (this.state.status !== 'ready') this.set({ status: 'error', error: (e && e.message) || String(e) });
    });

    setTimeout(() => this.check(), 5000);
    setInterval(() => this.check(), CHECK_EVERY);
  }

  check() {
    if (!this.au || this.state.status === 'downloading' || this.state.status === 'ready') return;
    this.au.checkForUpdates().catch(() => {});
  }

  // Cierra Lienzo, instala la versión nueva en silencio y la vuelve a abrir
  install() {
    if (!this.au || this.state.status !== 'ready') return;
    setImmediate(() => this.au.quitAndInstall(true, true));
  }
}

module.exports = new Updater();
