export function mergeCssModules(
  ...modules: ReadonlyArray<Record<string, string>>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const module of modules) {
    for (const [name, className] of Object.entries(module)) {
      merged[name] = merged[name] ? `${merged[name]} ${className}` : className;
    }
  }
  return merged;
}
