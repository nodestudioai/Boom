// Creación de las ventanas de Boom.
const { BrowserWindow } = require('electron');
const path = require('path');

const PRELOAD = path.join(__dirname, '..', 'preload.js');
const ICON = path.join(__dirname, '..', 'renderer', 'img', 'boom.png');
const page = (name, query = '') => `app://boom/${name}.html${query}`;
const prefs = (extra = {}) => ({
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  backgroundThrottling: false,
  ...extra,
});

function createPanel() {
  const win = new BrowserWindow({
    width: 460, height: 900, minWidth: 420, minHeight: 560,
    title: 'Boom', icon: ICON, backgroundColor: '#F3F6FC', autoHideMenuBar: true, show: false,
    webPreferences: prefs(),
  });
  win.removeMenu();
  win.loadURL(page('panel'));
  win.once('ready-to-show', () => win.show());
  return win;
}

// Ventana oculta que abre pantalla y micrófono y graba.
function createEngine() {
  const win = new BrowserWindow({ width: 320, height: 200, show: false, webPreferences: prefs() });
  win.loadURL(page('engine'));
  return win;
}

// La cámara: transparente, sin marco, siempre encima.
function createBubble(bounds) {
  const win = new BrowserWindow({
    ...bounds,
    frame: false, transparent: true, hasShadow: false, thickFrame: false,
    skipTaskbar: true, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, show: false, title: 'Boom · cámara',
    webPreferences: prefs(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL(page('bubble'));
  return win;
}

// Barra de control: no sale en la grabación (protección de contenido).
function createControl(display) {
  const width = 620, height = 68;
  const wa = display.workArea;
  const win = new BrowserWindow({
    width, height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + wa.height - height - 24),
    frame: false, transparent: true, hasShadow: false, thickFrame: false, resizable: false,
    skipTaskbar: true, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, show: false, title: 'Boom · control',
    webPreferences: prefs(),
  });
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL(page('control'));
  win.once('ready-to-show', () => { win.showInactive(); win.moveTop(); });
  return win;
}

function createCountdown(display, seconds) {
  const win = new BrowserWindow({
    ...display.bounds,
    frame: false, transparent: true, hasShadow: false, thickFrame: false, resizable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false,
    webPreferences: prefs(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadURL(page('countdown', `?s=${seconds}`));
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

// Botón para achicar la cámara cuando está a pantalla completa. No sale en la grabación.
function createCorner(bounds) {
  const win = new BrowserWindow({
    ...bounds,
    frame: false, transparent: true, hasShadow: false, thickFrame: false, resizable: false,
    skipTaskbar: true, maximizable: false, minimizable: false, fullscreenable: false, focusable: false,
    alwaysOnTop: true, show: false, title: 'Boom · achicar cámara',
    webPreferences: prefs(),
  });
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL(page('corner'));
  return win;
}

// Logo de marca de agua: una ventana real arriba a la izquierda, así queda dentro del video.
function createWatermark(bounds) {
  const win = new BrowserWindow({
    ...bounds,
    frame: false, transparent: true, hasShadow: false, thickFrame: false, resizable: false,
    skipTaskbar: true, maximizable: false, minimizable: false, fullscreenable: false, focusable: false,
    alwaysOnTop: true, show: false, title: 'Boom · marca de agua',
    webPreferences: prefs(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadURL(page('watermark'));
  return win;
}

module.exports = { createPanel, createEngine, createBubble, createControl, createCountdown, createCorner, createWatermark, ICON };
