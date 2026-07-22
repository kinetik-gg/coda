const SCENE_HEADING = /^(?:INT|EXT|EST|INT\.\/EXT|INT\/EXT|I\/E)(?:\.|\s)/iu;
const SCENE_NUMBER = /\s+#([^#\r\n]+)#\s*$/u;

export interface SceneHeadingMatch {
  text: string;
  forced: boolean;
  sceneNumber?: string;
}

export interface CharacterMatch {
  name: string;
  extension?: string;
  forced: boolean;
  dual: boolean;
}

export function matchSceneHeading(line: string): SceneHeadingMatch | undefined {
  const trimmed = line.trim();
  const forced = trimmed.startsWith('.') && !trimmed.startsWith('..');
  const candidate = forced ? trimmed.slice(1).trimStart() : trimmed;
  if (!forced && !SCENE_HEADING.test(candidate)) return undefined;

  const numberMatch = SCENE_NUMBER.exec(candidate);
  const text = numberMatch ? candidate.slice(0, numberMatch.index).trimEnd() : candidate;
  const sceneNumber = numberMatch?.[1]?.trim();
  return sceneNumber ? { text, forced, sceneNumber } : { text, forced };
}

export function matchCharacter(line: string): CharacterMatch | undefined {
  let candidate = line.trim();
  const forced = candidate.startsWith('@');
  if (forced) candidate = candidate.slice(1).trimStart();

  const dual = candidate.endsWith('^');
  if (dual) candidate = candidate.slice(0, -1).trimEnd();
  if (candidate === '' || (!forced && !isUppercaseCue(candidate))) return undefined;

  const extensionMatch = /\s+(\([^\r\n]+\))$/u.exec(candidate);
  const extension = extensionMatch?.[1];
  const name = extensionMatch ? candidate.slice(0, extensionMatch.index).trimEnd() : candidate;
  if (name === '') return undefined;
  return extension ? { name, extension, forced, dual } : { name, forced, dual };
}

export function isTransition(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.endsWith('TO:') && trimmed === trimmed.toUpperCase();
}

export function isDialogueFollower(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (/^={3,}\s*$/u.test(trimmed) || /^#{1,}\s+/u.test(trimmed)) return false;
  if (matchSceneHeading(trimmed) || isTransition(trimmed)) return false;
  return true;
}

function isUppercaseCue(candidate: string): boolean {
  const withoutExtension = candidate.replace(/\s+\([^\r\n]+\)$/u, '');
  return /\p{L}/u.test(withoutExtension) && withoutExtension === withoutExtension.toUpperCase();
}
