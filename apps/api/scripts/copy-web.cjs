const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../../web/dist');
const target = path.resolve(__dirname, '../dist/public');
if (!fs.existsSync(source)) throw new Error(`Web build not found at ${source}`);
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
