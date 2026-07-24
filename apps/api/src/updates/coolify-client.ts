/**
 * Minimal, timeout-bounded client for the two Coolify API operations the upgrade
 * ceremony needs: set the CODA_IMAGE environment variable on an application and
 * trigger its deployment. The surface is intentionally tiny — no listing, no
 * polling — so the adapter stays auditable.
 *
 * The API token is sent only in the Authorization header. It is never placed in a
 * URL, a request body, or an error message, so it cannot leak through logs or
 * responses. Callers must not log the config object either.
 */

export interface CoolifyClientConfig {
  baseUrl: string;
  apiToken: string;
  applicationUuid: string;
}

/** The env var the ceremony pins to the target image digest. */
export const CODA_IMAGE_ENV_KEY = 'CODA_IMAGE';

const DEFAULT_TIMEOUT_MS = 15_000;

/** A Coolify API failure with a sanitized, token-free message. */
export class CoolifyApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CoolifyApiError';
  }
}

/** Injectable fetch so tests never touch the network. Matches the global `fetch` shape. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CoolifyClientOptions {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/u, '');
}

export class CoolifyClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: CoolifyClientConfig,
    options: CoolifyClientOptions = {},
  ) {
    this.base = trimTrailingSlash(config.baseUrl);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** Update (or create) the CODA_IMAGE env var on the application to `imageRef`. */
  async setImageEnv(imageRef: string): Promise<void> {
    await this.request(
      `/api/v1/applications/${encodeURIComponent(this.config.applicationUuid)}/envs`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          key: CODA_IMAGE_ENV_KEY,
          value: imageRef,
          is_preview: false,
          is_build_time: false,
        }),
      },
    );
  }

  /** Trigger a deployment of the application. Returns the deployment UUID when Coolify reports one. */
  async deploy(): Promise<{ deploymentUuid: string | null }> {
    const payload = await this.request(
      `/api/v1/deploy?uuid=${encodeURIComponent(this.config.applicationUuid)}`,
      { method: 'POST' },
    );
    const deploymentUuid = extractDeploymentUuid(payload);
    return { deploymentUuid };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      // AbortError and network errors both surface here; never include the token.
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${this.timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : 'network error';
      throw new CoolifyApiError(`Coolify request failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await safeErrorDetail(response);
      throw new CoolifyApiError(
        `Coolify API returned ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
      );
    }
    return safeJson(response);
  }
}

/** Reads a bounded, best-effort error body without ever exposing request headers. */
async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300).trim();
  } catch {
    return '';
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
}

function extractDeploymentUuid(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const deployments: unknown = record.deployments;
  if (Array.isArray(deployments) && deployments.length > 0) {
    const first: unknown = deployments[0];
    if (first && typeof first === 'object') {
      const uuid = (first as Record<string, unknown>).deployment_uuid;
      if (typeof uuid === 'string') return uuid;
    }
  }
  const direct = record.deployment_uuid;
  return typeof direct === 'string' ? direct : null;
}
