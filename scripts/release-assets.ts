export interface ReleaseAssetMetadata {
  name: string;
  size: number;
}

export function missingReleaseAssets(
  expected: ReleaseAssetMetadata[],
  existing: ReleaseAssetMetadata[],
): string[] {
  const expectedByName = new Map(expected.map((asset) => [asset.name, asset]));
  for (const asset of existing) {
    const expectedAsset = expectedByName.get(asset.name);
    if (!expectedAsset) throw new Error(`Release contains unexpected asset ${asset.name}`);
    if (expectedAsset.size !== asset.size) {
      throw new Error(`Published asset ${asset.name} differs in size`);
    }
  }
  const existingNames = new Set(existing.map((asset) => asset.name));
  return expected.filter((asset) => !existingNames.has(asset.name)).map((asset) => asset.name);
}
