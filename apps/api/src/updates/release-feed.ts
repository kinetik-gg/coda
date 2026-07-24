import { parseReleaseDescriptor, type ReleaseDescriptor } from './release-descriptor.schema';

export const RELEASE_FEED_REPOSITORY = 'kinetik-gg/coda';
export const RELEASE_FEED_ASSET_NAME = 'release.json';
const GITHUB_API_BASE = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 10_000;

export interface LatestRelease {
  descriptor: ReleaseDescriptor;
  notesUrl: string | null;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  html_url?: unknown;
  assets?: GitHubReleaseAsset[];
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'coda-release-checker' },
    });
    if (!response.ok) {
      throw new Error(`Release feed request to ${url} failed with status ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function findReleaseAsset(release: GitHubRelease): GitHubReleaseAsset {
  const asset = (release.assets ?? []).find((entry) => entry.name === RELEASE_FEED_ASSET_NAME);
  if (!asset) throw new Error(`Latest release has no ${RELEASE_FEED_ASSET_NAME} asset`);
  return asset;
}

/**
 * Fetches the latest GitHub release's `release.json` asset and validates it. Throws on any
 * network failure, missing asset, or schema violation -- callers are responsible for treating
 * failures quietly.
 */
export async function fetchLatestRelease(): Promise<LatestRelease> {
  const release = (await fetchJson(
    `${GITHUB_API_BASE}/repos/${RELEASE_FEED_REPOSITORY}/releases/latest`,
  )) as GitHubRelease;
  const asset = findReleaseAsset(release);
  const payload = await fetchJson(asset.browser_download_url);
  return {
    descriptor: parseReleaseDescriptor(payload),
    notesUrl: typeof release.html_url === 'string' ? release.html_url : null,
  };
}
