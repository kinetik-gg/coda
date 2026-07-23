import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const usage = 'Usage: node operator/validate-deployment.js';

function run(executable: string, args: string[], environment = process.env): void {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Deployment validation failed with status ${result.status ?? 'unknown'}`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (args.length > 0) throw new Error(usage);

  const environment = {
    ...process.env,
    CODA_VALIDATE_RELEASE_BUNDLE: '1',
  };
  run(process.execPath, [resolve(__dirname, 'validate-deployments.js')], environment);
  run(process.execPath, [resolve(process.cwd(), 'deploy/coolify/validate.cjs')], environment);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Deployment validation failed'}\n`,
  );
  process.exitCode = 1;
}
