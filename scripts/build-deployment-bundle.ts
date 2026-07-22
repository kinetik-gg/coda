import { buildDeploymentBundle } from './deployment-bundle';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const result = buildDeploymentBundle({
  digest: argument('digest'),
  image: argument('image'),
  outputDirectory: argument('output'),
  repositoryRoot: process.cwd(),
  version: argument('version'),
});

process.stdout.write(
  `Built ${result.archivePath} and checksum for immutable image ${result.reference}.\n`,
);
