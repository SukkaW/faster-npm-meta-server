import { HttpError, toPackageError } from '../errors';
import { fetchPackageManifest } from './registry';
import type {
  FetchPackageManifest,
  FetchPackageManifests,
  ManifestFetchResult
} from '../types';

export const MANIFEST_BATCH_PATH = '/manifests';

interface ManifestBatchResponse {
  results: ManifestFetchResult[]
}

export interface DelegatedManifestFetcherOptions {
  /** Full endpoint URLs implementing the manifest batch protocol. */
  backends: readonly string[],
  /** Optional bearer token sent to a manifest backend. */
  token?: string,
  /** Injectable fetch implementation for tests and non-Workers runtimes. */
  fetch?: typeof fetch,
  /** Override backend selection; defaults to randomized round-robin. */
  selectBackend?: ManifestBackendSelector
}

export type ManifestBackendSelector = (
  backends: readonly string[],
  names: readonly string[]
) => string;

export function createLocalManifestBatchFetcher(
  fetchManifest: FetchPackageManifest = fetchPackageManifest
): FetchPackageManifests {
  return (names, force = false) => Promise.all(names.map(async (name) => {
    try {
      return {
        name,
        manifest: await fetchManifest(name, force)
      };
    } catch (error) {
      return toPackageError(error, name);
    }
  }));
}

export const fetchPackageManifests = createLocalManifestBatchFetcher();

/**
 * Delegated batch fetcher. Every non-empty package batch consumes exactly one
 * subrequest to a selected backend, regardless of its package count.
 */
export function createDelegatedManifestBatchFetcher(
  options: DelegatedManifestFetcherOptions
): FetchPackageManifests {
  const fetchImpl = options.fetch ?? fetch;
  const backends = options.backends.filter(Boolean);
  let backendIndex = backends.length > 0
    ? Math.floor(Math.random() * backends.length)
    : 0;

  return async (names, force = false) => {
    if (names.length === 0) {
      return [];
    }
    if (backends.length === 0) {
      throw new HttpError(
        'Manifest delegation requires a fetcher backend, but none is configured',
        { status: 503 }
      );
    }

    const backend = options.selectBackend
      ? options.selectBackend(backends, names)
      : backends[backendIndex++ % backends.length];

    const headers = new Headers({
      accept: 'application/json',
      'content-type': 'application/json'
    });
    if (options.token) {
      headers.set('authorization', `Bearer ${options.token}`);
    }

    let response: Response;
    try {
      response = await fetchImpl(backend, {
        method: 'POST',
        headers,
        body: JSON.stringify({ names, force })
      });
    } catch (error) {
      throw new HttpError(`Manifest backend request failed: ${backend}`, {
        status: 502,
        cause: error
      });
    }

    if (!response.ok) {
      throw new HttpError(
        `Manifest backend returned ${response.status}: ${backend}`,
        { status: 502 }
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new HttpError(`Manifest backend returned invalid JSON: ${backend}`, {
        status: 502,
        cause: error
      });
    }

    if (!isManifestBatchResponse(body)) {
      throw new HttpError(`Manifest backend returned an invalid response: ${backend}`, {
        status: 502
      });
    }
    return body.results;
  };
}

function isManifestBatchResponse(value: unknown): value is ManifestBatchResponse {
  if (!value || typeof value !== 'object' || !('results' in value)) {
    return false;
  }
  const results = value.results;
  if (!Array.isArray(results)) {
    return false;
  }
  for (let index = 0, len = results.length; index < len; index++) {
    const result = results[index];
    if (!result || typeof result !== 'object' || !('name' in result)) {
      return false;
    }
    if (typeof result.name !== 'string') {
      return false;
    }
    if ('manifest' in result) {
      if (!result.manifest || typeof result.manifest !== 'object') {
        return false;
      }
    } else if (
      !('error' in result)
      || typeof result.error !== 'string'
      || !('status' in result)
      || typeof result.status !== 'number'
    ) {
      return false;
    }
  }
  return true;
}
