// Runs under ELECTRON_RUN_AS_NODE=1: Electron's bundled Node/V8/ABI, no Chromium/display.
// Tests the two Electron questions that don't need a window: native-module (argon2) ABI
// and port binding of the real API inside the Electron runtime.
const path = require('node:path');
const Module = require('node:module');
const apiRequire = Module.createRequire(path.join(__dirname, '..', 'apps', 'api', 'package.json'));
const out = {
  abiModules: process.versions.modules,
  electron: process.versions.electron || '(run-as-node)',
  node: process.versions.node,
};
(async () => {
  try {
    const argon2 = apiRequire('argon2');
    const h = await argon2.hash('spike', { type: 2 });
    out.argon2 = (await argon2.verify(h, 'spike')) ? 'loaded+hash+verify OK (N-API prebuild)' : 'verify mismatch';
  } catch (e) {
    out.argon2 = 'FAILED: ' + e.message;
  }
  try {
    require('./boot-api');
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch('http://localhost:3000/');
    const html = await res.text();
    out.apiBoot = `listening (GET / -> ${res.status}, ${html.length}b, isHtml=${html.includes('<!doctype html') || html.includes('<div id="root"')})`;
    const health = await fetch('http://localhost:3000/api/v1/health/ready');
    out.health = `HTTP ${health.status}`;
  } catch (e) {
    out.apiBoot = 'FAILED: ' + e.message;
  }
  console.log('SPIKE_NODE_PROBE ' + JSON.stringify(out, null, 2));
  process.exit(0);
})();
