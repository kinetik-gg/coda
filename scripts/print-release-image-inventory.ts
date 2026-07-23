import { bundledReleaseImages } from './release-image-inventory';

process.stdout.write(`${JSON.stringify(bundledReleaseImages(process.cwd()))}\n`);
