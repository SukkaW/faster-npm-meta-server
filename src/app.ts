import type { Handler, Layer } from 'lemmih';
import type { QueryObject } from 'ufo';
import { App, res } from 'lemmih';
import { cors } from 'lemmih/cors';
import { parseQuery } from 'ufo';
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
import type { ParsedSpec } from './package-arg';
import { handlePackagesQuery } from './packages-query';
import { fetchPackageManifest } from './registry';
import type { FetchPackageManifest } from './types';

export interface AppOptions {
  deployRevision?: string,
  deployTime?: string,
  fetchManifest?: FetchPackageManifest
}

// mirrors the h3/nitro error JSON shape the official fast-npm-meta client
// relies on (`'error' in body` and `body.message`)
const errorLayer: Layer = async (request, next) => {
  try {
    return await next(request);
  } catch (error) {
    if (error instanceof HttpError) {
      return res.json({
        error: true,
        url: request.url,
        statusCode: error.status,
        statusMessage: 'Server Error',
        message: error.message
      }, { status: toErrorResponseStatus(error.status) });
    }

    console.error(error); // eslint-disable-line no-console -- logging to cloudflare workers console
    return res.json({
      error: true,
      url: request.url,
      statusCode: 500,
      statusMessage: 'Server Error',
      message: 'Server Error'
    }, { status: 500 });
  }
};

function packagesRoute(
  prefix: string,
  handler: (spec: ParsedSpec, query: QueryObject) => Promise<object>
): Handler<Record<never, never>> {
  return async (request) => {
    const url = new URL(request.url);
    return res.json(await handlePackagesQuery(
      url.pathname.slice(prefix.length),
      parseQuery(url.search),
      handler
    ));
  };
}

export function createApp(options: AppOptions = {}): App {
  const fetchManifest = options.fetchManifest ?? fetchPackageManifest;
  const deployTime = options.deployTime ?? new Date().toISOString();
  const deployRevision = options.deployRevision ?? 'development';

  // semver-valid prerelease version carrying the deploy identity instead of
  // a meaningless package.json version, e.g. 0.0.0-latest-0b8d1d7-20260731
  const version = `0.0.0-latest-${deployRevision.slice(0, 7)}-${deployTime.slice(0, 10).replaceAll('-', '')}`;

  const resolveRoute = packagesRoute(
    '/',
    (spec, query) => resolvePackageVersion(spec, query, fetchManifest)
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
    }))
    .route('/versions/*', packagesRoute(
      '/versions/',
      (spec, query) => getPackageVersions(spec, query, fetchManifest)
    ))
    .route('/full/*', packagesRoute(
      '/full/',
      (spec, query) => getFullPackageManifest(spec, query, fetchManifest)
    ))
    .route('/*', resolveRoute)
    // lemmih's trie does not backtrack, so bare /versions and /full need
    // explicit routes to keep resolving as npm package names like upstream
    .route('/versions', resolveRoute)
    .route('/full', resolveRoute);
}

// Response.json() throws on null-body statuses (204/304) and statuses
// outside 200-599
function toErrorResponseStatus(status: number): number {
  if (status !== 204 && status !== 304 && status >= 200 && status <= 599) {
    return status;
  }
  return 500;
}
