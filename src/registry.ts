import flru from 'flru';
import { joinURL } from 'ufo';
import {
  CDN_CACHE_TTL_BY_STATUS,
  FORCE_CACHE_TTL,
  FULL_PACKUMENT_ACCEPT,
  MANIFEST_CACHE_MAX,
  MANIFEST_CACHE_TTL,
  REGISTRY_URL,
  REGISTRY_USER_AGENT
} from './constants';
import { HttpError, toPackageError } from './errors';
import type {
  FetchPackageManifest,
  PackageManifest,
  PackageManifestError,
  PackageVersionMeta
} from './types';

interface PackumentVersion {
  name: string,
  engines?: Record<string, string>,
  deprecated?: string,
  dist?: {
    attestations?: {
      provenance?: {
        predicateType?: string
      }
    },
    integrity?: string
  },
  _npmUser?: {
    approver?: {
      email: string,
      name: string
    },
    email?: string,
    name?: string,
    trustedPublisher?: {
      id?: string,
      oidcConfigId?: string
    }
  }
}

interface Packument {
  name: string,
  versions: Record<string, PackumentVersion>,
  'dist-tags': Record<string, string> & {
    latest: string
  },
  time: Record<string, string> & {
    created: string,
    modified: string
  }
}

type ManifestCacheEntry = PackageManifest | PackageManifestError;

interface CloudflareRequestInit extends RequestInit<RequestInitCfProperties> {
  cache?: RequestCache
}

/** Each fetcher owns its own caches; the server uses the shared one below. */
export function createManifestFetcher(): FetchPackageManifest {
  const manifestCache = flru<ManifestCacheEntry>(MANIFEST_CACHE_MAX);
  const promiseCache = new Map<string, Promise<PackageManifest>>();

  return async function fetchPackageManifest(
    name: string,
    force = false
  ): Promise<PackageManifest> {
    const pending = promiseCache.get(name);
    if (pending) {
      return pending;
    }

    const storedData = manifestCache.get(name);
    if (storedData) {
      const timeout = force ? FORCE_CACHE_TTL : MANIFEST_CACHE_TTL;
      if (storedData.lastSynced + timeout > Date.now()) {
        if ('error' in storedData) {
          throw new Error(storedData.error);
        }
        return storedData;
      }
    }

    const promise = fetchAndProjectPackument(name, force)
      .then((manifest) => {
        manifestCache.set(name, manifest);
        return manifest;
      })
      .catch((error: unknown) => {
        const data: PackageManifestError = {
          ...toPackageError(error, name),
          lastSynced: Date.now()
        };
        manifestCache.set(name, data);
        throw error;
      })
      .finally(() => {
        promiseCache.delete(name);
      });

    promiseCache.set(name, promise);
    return promise;
  };
}

export const fetchPackageManifest = createManifestFetcher();

// upstream's ofetch retries GETs once, with no delay, on network errors and
// these status codes
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

async function fetchWithSingleRetry(
  url: string,
  init: CloudflareRequestInit
): Promise<Response> {
  let response: Response | undefined;
  try {
    response = await fetch(url, init);
  } catch {
    // network error, fall through to the retry
  }
  if (response && !RETRYABLE_STATUS_CODES.has(response.status)) {
    return response;
  }
  return fetch(url, init);
}

async function fetchAndProjectPackument(
  name: string,
  force: boolean
): Promise<PackageManifest> {
  console.log('Fetching package:', name); // eslint-disable-line no-console -- logging to cloudflare workers console

  const url = joinURL(REGISTRY_URL, name);
  const init: CloudflareRequestInit = {
    headers: {
      accept: FULL_PACKUMENT_ACCEPT,
      'user-agent': REGISTRY_USER_AGENT
    },
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: CDN_CACHE_TTL_BY_STATUS
    }
  };

  if (force) {
    // workerd only implements 'no-store' ('no-cache' throws a TypeError)
    init.cache = 'no-store';
  }

  const response = await fetchWithSingleRetry(url, init);
  if (!response.ok) {
    throw new HttpError(
      `[GET] "${url}": ${response.status} ${response.statusText}`,
      { status: response.status }
    );
  }

  const packument: Packument = await response.json();
  const versionsMeta: Record<string, PackageVersionMeta> = {};
  const versions = Object.keys(packument.versions);
  for (let index = 0, len = versions.length; index < len; index++) {
    const version = versions[index];
    versionsMeta[version] = createPackageVersionMeta(
      packument,
      version,
      packument.versions[version]
    );
  }

  return {
    name: packument.name,
    distTags: packument['dist-tags'],
    versionsMeta,
    timeCreated: packument.time.created,
    timeModified: packument.time.modified,
    lastSynced: Date.now()
  };
}

function createPackageVersionMeta(
  packument: Packument,
  version: string,
  data: PackumentVersion
): PackageVersionMeta {
  const metadata: PackageVersionMeta = {
    time: packument.time[version]
  };

  if (data.engines) {
    metadata.engines = data.engines;
  }
  if (data.deprecated) {
    metadata.deprecated = data.deprecated;
  }
  if (data.dist?.integrity) {
    metadata.integrity = data.dist.integrity;
  }
  if (data._npmUser?.trustedPublisher) {
    metadata.trustedPublisher = true;
  }
  if (data.dist?.attestations?.provenance) {
    metadata.provenance = true;
  }
  if (data._npmUser?.approver) {
    metadata.staged = true;
  }

  return metadata;
}
