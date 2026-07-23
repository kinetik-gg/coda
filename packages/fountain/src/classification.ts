const SCENE_HEADING = /^(?:INT\.\/EXT|INT\/EXT|I\/E|INT|EXT|EST)(?:\.|\s)/iu;
const FORCED_SCENE_HEADING = /^\.(?=[\p{L}\p{N}])/u;
const SCENE_NUMBER = /\s+#((?=[\p{L}\p{N}.-]*[\p{L}\p{N}])[\p{L}\p{N}.-]+)#\s*$/u;

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
  const forced = FORCED_SCENE_HEADING.test(trimmed);
  const candidate = forced ? trimmed.slice(1) : trimmed;
  if (!forced && !SCENE_HEADING.test(candidate)) return undefined;

  const numberMatch = SCENE_NUMBER.exec(candidate);
  const text = numberMatch ? candidate.slice(0, numberMatch.index).trimEnd() : candidate;
  const sceneNumber = numberMatch?.[1]?.trim();
  return sceneNumber ? { text, forced, sceneNumber } : { text, forced };
}

export function matchCharacter(line: string): CharacterMatch | undefined {
  let candidate = line.trim();
  const forced = candidate.startsWith('@');
  if (!forced && candidate.startsWith('!')) return undefined;
  if (!forced && (matchSceneHeading(candidate) || isTransitionCandidate(candidate))) {
    return undefined;
  }
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
  return isAutomaticTransitionText(line.trimStart());
}

export function isTransitionCandidate(line: string): boolean {
  return isAutomaticTransitionText(line.trim());
}

export function isDialogueFollower(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('/*') || trimmed.startsWith('[[')) return false;
  if (/^={3,}\s*$/u.test(trimmed) || /^#{1,}\s+/u.test(trimmed)) return false;
  if (matchSceneHeading(trimmed) || isTransitionCandidate(line)) return false;
  return true;
}

function isAutomaticTransitionText(candidate: string): boolean {
  return candidate.endsWith('TO:') && candidate === candidate.toUpperCase();
}

function isUppercaseCue(candidate: string): boolean {
  const withoutExtension = candidate.replace(/\s+\([^\r\n]+\)$/u, '');
  return /\p{L}/u.test(withoutExtension) && withoutExtension === withoutExtension.toUpperCase();
}
