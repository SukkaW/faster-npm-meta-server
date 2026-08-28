import type { Handler, Layer } from 'lemmih';
import type { QueryObject } from 'ufo';
import { App, res } from 'lemmih';
import { cors } from 'lemmih/cors';
import { parseQuery } from 'ufo';
import {
  CACHEABLE_INDEX,
  cacheControlForErrorStatus,
  cacheControlForResults,
  NO_STORE
} from './cache-control';
import {
  REPOSITORY_URL,
  SERVICE_NAME
} from './constants';
import { HttpError } from './errors';
import {
  getFullPackageManifest,
  getPackageVersions,
  resolvePackageVersion
} from './handlers';
import {
  createDelegatedManifestBatchFetcher,
  createLocalManifestBatchFetcher,
  fetchPackageManifests
} from './manifest/batch';
import type { ManifestBackendSelector } from './manifest/batch';
import type { ParsedSpec } from './package-arg';
import { handlePackagesQuery } from './packages-query';
import type {
  FetchPackageManifest,
  FetchPackageManifests,
  PackageManifest
} from './types';

export interface AppOptions {
  deployRevision?: string,
  deployTime?: string,
  /** Defaults to Local, which fans out directly from a Cloudflare Worker. */
  mode?: AppMode,
  /** Manifest batch endpoint URLs used in Delegate mode. */
  backends?: readonly string[],
  /** Optional bearer token shared with manifest backends. */
  backendToken?: string,
  /** Injectable outbound fetch used for delegated backend requests. */
  fetch?: typeof fetch,
  selectBackend?: ManifestBackendSelector,
  /** Compatibility adapter for callers that fetch one manifest at a time. */
  fetchManifest?: FetchPackageManifest,
  /** Lower-level override for custom batch providers and tests. */
  fetchManifests?: FetchPackageManifests
}

export enum AppMode {
  Local = 'local',
  Delegate = 'delegate'
}

// mirrors the h3/nitro error JSON shape the official fast-npm-meta client
// relies on (`'error' in body` and `body.message`)
const errorLayer: Layer = async (request, next) => {
  try {
    return await next(request);
  } catch (error) {
    if (error instanceof HttpError) {
      const status = toErrorResponseStatus(error.status);
      return res.json({
        error: true,
        url: request.url,
        statusCode: error.status,
        statusMessage: 'Server Error',
        message: error.message
      }, {
        status,
        headers: {
          'cache-control': cacheControlForErrorStatus(isForced(request), status)
        }
      });
    }

    console.error(error); // eslint-disable-line no-console -- logging to cloudflare workers console
    return res.json({
      error: true,
      url: request.url,
      statusCode: 500,
      statusMessage: 'Server Error',
      message: 'Server Error'
    }, {
      status: 500,
      headers: { 'cache-control': NO_STORE }
    });
  }
};

function isForced(request: Request): boolean {
  return Boolean(parseQuery(new URL(request.url).search).force);
}

function packagesRoute(
  prefix: string,
  fetchManifests: FetchPackageManifests,
  handler: (
    spec: ParsedSpec,
    query: QueryObject,
    manifest: PackageManifest
  ) => Promise<object> | object
): Handler<Record<never, never>> {
  return async (request) => {
    const url = new URL(request.url);
    const query = parseQuery(url.search);
    const results = await handlePackagesQuery(
      url.pathname.slice(prefix.length),
      query,
      fetchManifests,
      handler
    );
    return res.json(results, {
      headers: {
        'cache-control': cacheControlForResults(Boolean(query.force), results)
      }
    });
  };
}

export function createApp(options: AppOptions = {}): App {
  const fetchManifests = options.fetchManifests
    ?? createAppManifestFetcher(options);
  const deployTime = options.deployTime ?? new Date().toISOString();
  const deployRevision = options.deployRevision ?? 'development';

  // semver-valid prerelease version carrying the deploy identity instead of
  // a meaningless package.json version, e.g. 0.0.0-latest-0b8d1d7-20260731
  const version = `0.0.0-latest-${deployRevision.slice(0, 7)}-${deployTime.slice(0, 10).replaceAll('-', '')}`;

  const resolveRoute = packagesRoute(
    '/',
    fetchManifests,
    resolvePackageVersion
  );

  return new App()
    .layer(
      cors({
        origin: '*',
        allowHeaders: ['*'],
        allowMethods: ['*'],
        exposeHeaders: ['*']
      }),
      errorLayer
    )
    .route('/', () => res.json({
      name: SERVICE_NAME,
      version,
      docs: REPOSITORY_URL,
      deployTime,
      deployRevision: `${REPOSITORY_URL}/commit/${deployRevision}`
    }, {
      headers: { 'cache-control': CACHEABLE_INDEX }
    }))
    .route('/versions/*', packagesRoute(
      '/versions/',
      fetchManifests,
      getPackageVersions
    ))
    .route('/full/*', packagesRoute(
      '/full/',
      fetchManifests,
      getFullPackageManifest
    ))
    .route('/*', resolveRoute)
    // lemmih's trie does not backtrack, so bare /versions and /full need
    // explicit routes to keep resolving as npm package names like upstream
    .route('/versions', resolveRoute)
    .route('/full', resolveRoute);
}

function createAppManifestFetcher(options: AppOptions): FetchPackageManifests {
  if (options.mode === AppMode.Delegate) {
    return createDelegatedManifestBatchFetcher({
      backends: options.backends ?? [],
      token: options.backendToken,
      fetch: options.fetch,
      selectBackend: options.selectBackend
    });
  }
  return options.fetchManifest
    ? createLocalManifestBatchFetcher(options.fetchManifest)
    : fetchPackageManifests;
}

// Response.json() throws on null-body statuses (204/304) and statuses
// outside 200-599
function toErrorResponseStatus(status: number): number {
  if (status !== 204 && status !== 304 && status >= 200 && status <= 599) {
    return status;
  }
  return 500;
}
