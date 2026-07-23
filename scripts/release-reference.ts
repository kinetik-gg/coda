const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const imagePattern = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[0-9]+)?$/u;

export function immutableReleaseReference(image: string, digest: string): string {
  if (!imagePattern.test(image)) throw new Error('Release image name is invalid');
  if (!digestPattern.test(digest)) throw new Error('Release image digest is invalid');
  return `${image}@${digest}`;
}

export function immutableReleaseNote(image: string, digest: string): string {
  return `Immutable container: \`${immutableReleaseReference(image, digest)}\``;
}
