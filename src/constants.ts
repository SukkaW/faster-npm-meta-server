export const SERVICE_NAME = 'faster-npm-meta-server';
export const REPOSITORY_URL = 'https://github.com/SukkaW/faster-npm-meta-server';

export const REGISTRY_URL = 'https://registry.npmjs.org/';
export const REGISTRY_USER_AGENT = 'faster-npm-meta-server (https://github.com/SukkaW/faster-npm-meta-server)';

export const MANIFEST_CACHE_MAX = 10000;
export const MANIFEST_CACHE_TTL = 15 * 60 * 1000;
export const FORCE_CACHE_TTL = 30 * 1000;

export const FULL_PACKUMENT_ACCEPT = 'application/json';

/**
 * Cache TTL, in seconds. Matches the in-isolate manifest TTL: responses are
 * already allowed to be that stale, so the CDN cache adds no staleness beyond
 * what the server itself serves.
 */
export const CACHE_TTL = MANIFEST_CACHE_TTL / 1000;
/**
 * TTL for responses that carry an error, in seconds. Kept short because an
 * error may be transient (a registry hiccup) or may resolve on its own (a
 * package that gets published).
 */
export const ERROR_CACHE_TTL = 60;
/** TTL for the service metadata route, in seconds. Changes only on deploy. */
export const INDEX_CACHE_TTL = 60;

export const CDN_CACHE_TTL_BY_STATUS = {
  '200-299': MANIFEST_CACHE_TTL / 1000,
  404: MANIFEST_CACHE_TTL / 1000,
  '500-599': 0
} as const;
