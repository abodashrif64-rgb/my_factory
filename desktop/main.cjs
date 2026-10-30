const { app, BrowserWindow, session, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');

app.setName('Mada');
// Keep records at one stable path when the portable application folder moves.
const userDataDirectory = path.join(app.getPath('appData'), 'Mada');
fs.mkdirSync(userDataDirectory, { recursive: true });
app.setPath('userData', userDataDirectory);
const hasLock = app.requestSingleInstanceLock();
let mainWindow;

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  const createWindow = () => {
    const entry = path.resolve(__dirname, '../dist/index.html');
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 900,
      minHeight: 650,
      backgroundColor: '#f6f7fb',
      title: 'مدى | إدارة أعمالك',
      icon: path.join(__dirname, 'icon.png'),
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    mainWindow.removeMenu();
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, destination) => {
      try {
        const next = new URL(destination);
        if (next.protocol !== 'file:' || path.resolve(fileURLToPath(next)) !== entry) event.preventDefault();
      } catch { event.preventDefault(); }
    });
    mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        dialog.showErrorBox('تعذّر فتح مدى', `تعذّر تحميل ملفات البرنامج. تأكد من فك ضغط المجلد كاملًا.\n${errorDescription}`);
        console.error('Application load failed:', errorCode);
      }
    });
    mainWindow.on('closed', () => { mainWindow = undefined; });
    mainWindow.loadFile(entry);
  };

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // All interface assets are bundled. The installed application has no network dependency.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const protocol = new URL(details.url).protocol;
      callback({ cancel: !['file:', 'data:', 'blob:', 'devtools:'].includes(protocol) });
    });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
