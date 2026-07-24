// THROWAWAY Electron main: boot the REAL API inside the Electron main process and load
// the served SPA in a BrowserWindow. Answers the Electron-specific spike questions:
// argon2 native-module ABI, port binding, and SPA serving from inside Electron.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const Module = require('node:module');

const results = {
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  abiModules: process.versions.modules,
};
const apiRequire = Module.createRequire(path.join(__dirname, '..', 'apps', 'api', 'package.json'));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

function finish() {
  console.log('SPIKE_ELECTRON_RESULT ' + JSON.stringify(results));
  setTimeout(() => app.quit(), 300);
}

app.whenReady().then(async () => {
  // 1) argon2 native module under the Electron ABI (the classic pain point).
  try {
    const argon2 = apiRequire('argon2');
    results.argon2Require = 'ok';
    const h = await argon2.hash('spike-password', { type: 2 });
    results.argon2Hash = h.slice(0, 24) + '...';
    results.argon2Verify = await argon2.verify(h, 'spike-password');
  } catch (e) {
    results.argon2 = 'FAILED: ' + e.message;
  }

  // 2) Boot the real API (port binding inside Electron main) + fake-S3.
  try {
    require('./boot-api');
    await new Promise((r) => setTimeout(r, 5000));
    results.apiBoot = 'listening';
  } catch (e) {
    results.apiBoot = 'FAILED: ' + e.message;
  }

  // 3) SPA serving: load the API-served SPA in a hidden BrowserWindow.
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  let settled = false;
  const settle = (v) => { if (!settled) { settled = true; results.spa = v; finish(); } };
  win.webContents.on('did-finish-load', async () => {
    const title = await win.webContents.executeJavaScript('document.title').catch(() => '?');
    const hasRoot = await win.webContents
      .executeJavaScript("!!document.querySelector('#root, #app, body *')").catch(() => false);
    settle(`loaded (title=${JSON.stringify(title)}, hasContent=${hasRoot})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => settle(`FAIL ${code} ${desc}`));
  win.loadURL('http://localhost:3000');
  setTimeout(() => settle('timeout'), 15000);
});
