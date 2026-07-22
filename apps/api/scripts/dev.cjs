const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const packageRoot = resolve(__dirname, '..');
const tsc = require.resolve('typescript/bin/tsc');
const localEnv = resolve(packageRoot, '..', '..', '.env.local');
try {
  process.loadEnvFile(localEnv);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const initial = spawnSync(
  process.execPath,
  [tsc, '-p', 'tsconfig.build.json', '--pretty', 'false'],
  {
    cwd: packageRoot,
    stdio: 'inherit',
  },
);
if (initial.status !== 0) process.exit(initial.status ?? 1);

const compiler = spawn(
  process.execPath,
  [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput', '--pretty', 'false'],
  { cwd: packageRoot, stdio: 'inherit' },
);
const server = spawn(process.execPath, ['--watch', 'dist/main.js'], {
  cwd: packageRoot,
  stdio: 'inherit',
  env: process.env,
});

function shutdown(signal) {
  compiler.kill(signal);
  server.kill(signal);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
compiler.once('exit', (code) => {
  if (code && code !== 0) process.exitCode = code;
});
server.once('exit', (code) => {
  if (code && code !== 0) process.exitCode = code;
});
