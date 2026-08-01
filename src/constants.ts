export const SERVICE_NAME = 'fast-npm-meta';
export const REPOSITORY_URL = 'https://github.com/SukkaW/faster-npm-meta-server';

export const REGISTRY_URL = 'https://registry.npmjs.org/';
export const REGISTRY_USER_AGENT = 'faster-npm-meta-server (https://github.com/SukkaW/faster-npm-meta-server)';

export const MANIFEST_CACHE_MAX = 10000;
export const MANIFEST_CACHE_TTL = 15 * 60 * 1000;
export const FORCE_CACHE_TTL = 30 * 1000;

export const FULL_PACKUMENT_ACCEPT = 'application/json';

export const CDN_CACHE_TTL_BY_STATUS = {
  '200-299': MANIFEST_CACHE_TTL / 1000,
  404: MANIFEST_CACHE_TTL / 1000,
  '500-599': 0
} as const;
