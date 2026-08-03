/**
 * `Cache-Control` policy, so a CDN cache can sit in front of the Worker and
 * absorb repeat traffic (Cloudflare only caches a Worker response when it
 * carries an explicit `Cache-Control`).
 *
 * The server already serves data that is up to `MANIFEST_CACHE_TTL` stale from
 * its in-isolate cache, so a CDN cache with the same TTL introduces no new
 * staleness. Responses that carry an error get a much shorter TTL, and
 * `?force=true` — whose entire purpose is bypassing caches — is never stored.
 *
 * Only `max-age` is emitted: the consumers of this API are CLIs (taze,
 * fast-npm-meta) that ignore cache headers entirely, so a separate `s-maxage`
 * for shared caches would be moving parts with nothing reading them.
 */
import {
  CACHE_TTL,
  ERROR_CACHE_TTL,
  INDEX_CACHE_TTL
} from './constants';

export const NO_STORE = 'no-store';

export const CACHEABLE = `public, max-age=${CACHE_TTL}`;
export const CACHEABLE_ERROR = `public, max-age=${ERROR_CACHE_TTL}`;
export const CACHEABLE_INDEX = `public, max-age=${INDEX_CACHE_TTL}`;

/**
 * Policy for a package query response. `results` is the value about to be
 * serialized — a single result, or an array for batch queries.
 */
export function cacheControlForResults(force: boolean, results: unknown): string {
  if (force) {
    return NO_STORE;
  }
  // `?throw=false` turns failures into per-package error objects inside a 200
  // response, so the body has to be consulted, not just the status
  return containsError(results) ? CACHEABLE_ERROR : CACHEABLE;
}

/** Policy for an error response produced by the error layer. */
export function cacheControlForErrorStatus(force: boolean, status: number): string {
  // never persist a server-side failure; it is by definition not a stable answer
  if (force || status >= 500) {
    return NO_STORE;
  }
  return CACHEABLE_ERROR;
}

function containsError(results: unknown): boolean {
  if (Array.isArray(results)) {
    for (let index = 0, len = results.length; index < len; index++) {
      if (isError(results[index])) {
        return true;
      }
    }
    return false;
  }
  return isError(results);
}

function isError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'error' in value;
}
