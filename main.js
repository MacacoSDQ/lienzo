const { app, Tray, Menu, BrowserWindow, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Si algo falla, que se vea (y quede guardado en %APPDATA%\Lienzo\lienzo.log)
function logError(e) {
  const text = `[${new Date().toISOString()}] ${(e && e.stack) || e}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'lienzo.log'), text);
  } catch {}
  return text;
}
process.on('uncaughtException', (e) => {
  const text = logError(e);
  if (app.isReady()) dialog.showErrorBox('Lienzo tuvo un error', text);
});
process.on('unhandledRejection', (e) => logError(e));
const store = require('./src/store');
const { DiscordBridge } = require('./src/discord');
const { buildState } = require('./src/payload');
const updater = require('./src/updater');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let tray = null;
let win = null;
let bridge = null;
let dialogOpen = false;
let ignoreBlurUntil = 0; // al abrir, Windows a veces quita el foco un instante
let lastHidden = 0;

/* ---------- Ventana emergente (la galería) ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: '#121318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('blur', () => {
    if (Date.now() < ignoreBlurUntil) return;
    if (!dialogOpen && !win.webContents.isDevToolsOpened()) hideWindow();
  });
}

function positionWindow() {
  const tb = tray.getBounds();
  const { width: w, height: h } = win.getBounds();
  const anchor = tb.width ? { x: tb.x + tb.width / 2, y: tb.y } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(anchor).workArea;

  let x = Math.round(anchor.x - w / 2);
  let y = anchor.y > wa.y + wa.height / 2 ? wa.y + wa.height - h - 10 : wa.y + 10;
  x = Math.max(wa.x + 10, Math.min(x, wa.x + wa.width - w - 10));
  win.setPosition(x, y, false);
}

function showWindow() {
  ignoreBlurUntil = Date.now() + 800;
  positionWindow();
  win.show();
  win.moveTop();
  win.focus();
  pushState();
}

function hideWindow() {
  lastHidden = Date.now();
  win.hide();
}

function toggleWindow() {
  // Al hacer click en el icono, primero llega el "blur" que la oculta:
  // si se acaba de ocultar, el click era para cerrarla, no para reabrirla.
  if (win.isVisible()) hideWindow();
  else if (Date.now() - lastHidden > 250) showWindow();
}

/* ---------- Estado compartido con la UI ---------- */

function state() {
  return {
    backgrounds: store.list('backgrounds'),
    fonts: store.list('fonts'),
    config: store.config,
    status: bridge.status,
    discordFound: !!bridge.exePath,
    lastError: bridge.lastError,
    discordInfo: bridge.heartbeat || null,
    appVersion: app.getVersion(),
    update: updater.state,
  };
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', state());
}

function reapply() {
  bridge.reapply();
}

function setOption(key, value) {
  const allowed = { dim: 'number', blur: 'number', autoStart: 'boolean' };
  if (allowed[key] !== typeof value) return;
  store.set(key, value);
  if (key === 'autoStart') {
    app.setLoginItemSettings({ openAtLogin: value, args: ['--hidden'] });
    updateMenu();
  } else {
    reapply();
  }
}

/* ---------- Menú del icono (click derecho) ---------- */

function updateMenu() {
  const labels = {
    connected: 'Discord conectado ✓',
    launching: 'Abriendo Discord…',
    'needs-restart': 'Reiniciar Discord para aplicar',
    disconnected: 'Abrir Discord',
  };
  const up = updater.state;
  const updateItems =
    up.status === 'ready'
      ? [{ label: `⬆  Actualizar a v${up.version} y reiniciar`, click: () => updater.install() }, { type: 'separator' }]
      : [];
  const menu = Menu.buildFromTemplate([
    ...updateItems,
    { label: 'Cambiar fondo / fuente…', click: showWindow },
    {
      label: labels[bridge.status] || 'Abrir Discord',
      enabled: bridge.status === 'needs-restart' || bridge.status === 'disconnected',
      click: () => bridge.launch(),
    },
    {
      label: 'Quitar personalización',
      click: () => {
        store.select('backgrounds', null);
        store.select('fonts', null);
        reapply();
        pushState();
      },
    },
    { type: 'separator' },
    {
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: !!store.config.autoStart,
      click: (item) => setOption('autoStart', item.checked),
    },
    { label: 'Abrir carpeta de la biblioteca', click: () => shell.openPath(store.LIB) },
    {
      label: 'Quitar Lienzo de Discord',
      click: () => {
        bridge.unpatch();
        dialog.showMessageBox({
          type: 'info',
          message: 'Lienzo se quitó de Discord.',
          detail: 'Reinicia Discord para volver al aspecto normal. Se volverá a activar la próxima vez que abras Lienzo.',
        });
      },
    },
    { type: 'separator' },
    {
      label: `Lienzo v${app.getVersion()} — buscar actualizaciones`,
      enabled: up.status !== 'disabled',
      click: () => updater.check(),
    },
    { label: 'Salir', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

/* ---------- IPC ---------- */

ipcMain.handle('state', () => state());

ipcMain.handle('add', async (_e, kind) => {
  if (!['backgrounds', 'fonts'].includes(kind)) return state();
  const filters =
    kind === 'backgrounds'
      ? [{ name: 'Imágenes', extensions: store.EXTENSIONS.backgrounds }]
      : [{ name: 'Fuentes', extensions: store.EXTENSIONS.fonts }];

  dialogOpen = true;
  const res = await dialog.showOpenDialog(win, {
    title: kind === 'backgrounds' ? 'Agregar fondos' : 'Agregar fuentes',
    properties: ['openFile', 'multiSelections'],
    filters,
  });
  dialogOpen = false;
  win.show();
  win.focus();

  if (!res.canceled && res.filePaths.length) {
    const added = store.add(kind, res.filePaths);
    if (added.length) {
      store.select(kind, added[added.length - 1]);
      reapply();
    }
  }
  return state();
});

ipcMain.handle('remove', (_e, kind, id) => {
  store.remove(kind, id);
  reapply();
  return state();
});

ipcMain.handle('select', (_e, kind, id) => {
  store.select(kind, id);
  reapply();
  return state();
});

ipcMain.handle('option', (_e, key, value) => {
  setOption(key, value);
  return state();
});

ipcMain.handle('connect', async () => {
  await bridge.launch();
  return state();
});

ipcMain.handle('hide', () => hideWindow());
ipcMain.handle('install-update', () => updater.install());

/* ---------- Arranque ---------- */

app.on('second-instance', () => win && showWindow());
app.on('window-all-closed', () => {}); // vive en la bandeja

app.whenReady().then(() => {
  createWindow();

  const iconFile = process.platform === 'win32' ? 'tray.ico' : 'tray.png';
  tray = new Tray(path.join(__dirname, 'assets', iconFile));
  tray.setToolTip('Lienzo — fondos para Discord');
  tray.on('click', toggleWindow);

  bridge = new DiscordBridge({
    dir: path.join(app.getPath('userData'), 'discord'),
    getState: () => buildState(store),
  });
  bridge.on('status', () => {
    updateMenu();
    pushState();
  });
  bridge.start();
  updateMenu();

  updater.on('change', () => {
    updateMenu();
    pushState();
  });
  updater.on('ready', (version) => {
    tray.setToolTip(`Lienzo — actualización v${version} lista`);
    if (process.platform === 'win32') {
      tray.displayBalloon({
        title: 'NEW UPDATE AVAILABLE',
        content: `Lienzo v${version} está lista. Haz click en el icono para actualizar.`,
      });
    }
  });
  updater.start();

  // Abrir con Windows (activado por defecto; se cambia desde el menú del icono)
  app.setLoginItemSettings({ openAtLogin: !!store.config.autoStart, args: ['--hidden'] });

  // Si lo abres tú (barra de tareas, menú inicio), enseña la galería directamente.
  // Al arrancar con Windows (--hidden) se queda callado en la bandeja.
  if (!process.argv.includes('--hidden')) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', showWindow);
    else showWindow();
  }

  if (store.config.firstRun) {
    store.set('firstRun', false);
    if (process.platform === 'win32') {
      tray.displayBalloon({
        title: 'Lienzo está en la bandeja',
        content: 'Haz click en el icono para elegir tu fondo y tu fuente de Discord.',
      });
    }
  }
});
