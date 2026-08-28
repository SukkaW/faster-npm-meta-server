import type { Request as MiniflareRequest } from 'miniflare';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect } from 'earl';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { after, before, describe, it } from 'mocha';
import { CACHEABLE, NO_STORE } from '../src/cache-control';
import { SERVICE_NAME } from '../src/constants';

/**
 * Boots the built dist/worker.js in workerd (via miniflare) with the npm
 * registry mocked at the outbound-fetch boundary. This is the layer that
 * catches bundling and runtime problems unit tests cannot see: unresolved
 * requires turned into `createRequire` (no import.meta.url in workerd),
 * unsupported fetch cache modes, missing node builtins, etc.
 */
const packument = {
  name: 'fixture',
  'dist-tags': { latest: '2.0.0' },
  versions: {
    '1.0.0': { name: 'fixture', engines: { node: '>=18' }, dist: {} },
    '2.0.0': { name: 'fixture', dist: { integrity: 'sha512-fixture' } }
  },
  time: {
    created: '2024-01-01T00:00:00.000Z',
    modified: '2025-01-01T00:00:00.000Z',
    '1.0.0': '2024-01-01T00:00:00.000Z',
    '2.0.0': '2025-01-01T00:00:00.000Z'
  }
};

function createManifest(name: string) {
  return {
    name,
    distTags: packument['dist-tags'],
    versionsMeta: {
      '1.0.0': {
        time: packument.time['1.0.0'],
        engines: packument.versions['1.0.0'].engines
      },
      '2.0.0': {
        time: packument.time['2.0.0'],
        integrity: packument.versions['2.0.0'].dist.integrity
      }
    },
    timeCreated: packument.time.created,
    timeModified: packument.time.modified,
    lastSynced: Date.now()
  };
}

function mockRegistry(request: MiniflareRequest): MiniflareResponse {
  const url = new URL(request.url);
  if (url.hostname === 'registry.npmjs.org') {
    const name = decodeURIComponent(url.pathname.slice(1));
    if (name === 'fixture') {
      return new MiniflareResponse(JSON.stringify(packument), {
        headers: { 'content-type': 'application/json' }
      });
    }
    return new MiniflareResponse(null, { status: 404, statusText: 'Not Found' });
  }
  return new MiniflareResponse(null, { status: 502 });
}

let snippetRegistryRequests = 0;
let snippetBackendRequests = 0;
let snippetBackendAuthorization: string | null = null;

async function mockSnippetOutbound(
  request: MiniflareRequest
): Promise<MiniflareResponse> {
  const url = new URL(request.url);
  if (url.hostname === 'registry.npmjs.org') {
    snippetRegistryRequests++;
    return mockRegistry(request);
  }
  if (url.hostname === 'fetcher.example') {
    snippetBackendRequests++;
    snippetBackendAuthorization = request.headers.get('authorization');
    const body = await request.json() as { names: string[] };
    return new MiniflareResponse(JSON.stringify({
      results: body.names.map(name => ({
        name,
        manifest: createManifest(name)
      }))
    }), {
      headers: { 'content-type': 'application/json' }
    });
  }
  return new MiniflareResponse(null, { status: 502 });
}

describe('built worker bundle in workerd', function () {
  this.timeout(120000);

  let mf: Miniflare;
  let snippetMf: Miniflare;
  let fetcherMf: Miniflare;

  before(() => {
    execFileSync('pnpm', ['run', 'build'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        FETCHER_BACKENDS: 'https://fetcher.example/manifests',
        FETCHER_TOKEN: 'test-token'
      },
      stdio: 'ignore'
    });

    mf = new Miniflare({
      scriptPath: 'dist/worker.js',
      modules: true,
      // keep in sync with wrangler.toml
      compatibilityDate: '2025-03-28',
      outboundService: mockRegistry
    });
    snippetMf = new Miniflare({
      scriptPath: 'dist/snippet.js',
      modules: true,
      compatibilityDate: '2025-03-28',
      outboundService: mockSnippetOutbound
    });
    fetcherMf = new Miniflare({
      scriptPath: 'dist/fetcher.js',
      modules: true,
      compatibilityDate: '2025-03-28',
      bindings: { MANIFEST_BACKEND_TOKEN: 'test-token' },
      outboundService: mockRegistry
    });
  });

  after(() => Promise.all([
    mf.dispose(),
    snippetMf.dispose(),
    fetcherMf.dispose()
  ]));

  it('boots and serves the root route', async () => {
    const response = await mf.dispatchFetch('http://localhost/');
    expect(response.status).toEqual(200);
    expect(await response.json() as object).toHaveSubset({ name: SERVICE_NAME });
  });

  it('resolves packages through the real bundle', async () => {
    const response = await mf.dispatchFetch('http://localhost/fixture@^1.0.0');
    expect(response.status).toEqual(200);
    expect(await response.json() as object).toHaveSubset({
      name: 'fixture',
      specifier: '^1.0.0',
      version: '1.0.0'
    });
    // the CDN in front of the Worker only caches with an explicit Cache-Control
    expect(response.headers.get('cache-control')).toEqual(CACHEABLE);
  });

  it('supports force=true (fetch cache mode must be valid in workerd)', async () => {
    const response = await mf.dispatchFetch('http://localhost/fixture?force=true');
    expect(response.status).toEqual(200);
    expect(await response.json() as object).toHaveSubset({
      name: 'fixture',
      version: '2.0.0'
    });
    expect(response.headers.get('cache-control')).toEqual(NO_STORE);
  });

  it('returns upstream-shaped errors', async () => {
    const response = await mf.dispatchFetch('http://localhost/missing');
    expect(response.status).toEqual(404);
    expect(await response.json() as object).toHaveSubset({
      error: true,
      statusCode: 404,
      message: '[GET] "https://registry.npmjs.org/missing": 404 Not Found'
    });
  });

  it('keeps double-encoded plus handling in the bundle', async () => {
    const response = await mf.dispatchFetch(
      'http://localhost/fixture@1.0.0%252Bfixture@2.0.0?throw=false'
    );
    const result = await response.json() as Record<string, unknown>;
    expect(Array.isArray(result)).toEqual(false);
    expect(result).toHaveSubset({ status: 400 });
  });

  it('delegates a single-package Snippet request in one subrequest', async () => {
    const registryRequests = snippetRegistryRequests;
    const backendRequests = snippetBackendRequests;
    const response = await snippetMf.dispatchFetch('http://localhost/fixture');

    expect(response.status).toEqual(200);
    expect(snippetRegistryRequests).toEqual(registryRequests);
    expect(snippetBackendRequests).toEqual(backendRequests + 1);
    expect(snippetBackendAuthorization).toEqual('Bearer test-token');
  });

  it('delegates a multi-package Snippet request in one subrequest', async () => {
    const registryRequests = snippetRegistryRequests;
    const backendRequests = snippetBackendRequests;
    const response = await snippetMf.dispatchFetch(
      'http://localhost/fixture+other'
    );

    expect(response.status).toEqual(200);
    expect(await response.json() as unknown[]).toHaveLength(2);
    expect(snippetRegistryRequests).toEqual(registryRequests);
    expect(snippetBackendRequests).toEqual(backendRequests + 1);
    expect(snippetBackendAuthorization).toEqual('Bearer test-token');
  });

  it('serves authenticated batches from the fetcher bundle', async () => {
    const response = await fetcherMf.dispatchFetch(
      'http://localhost/manifests',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          names: ['fixture', 'missing'],
          force: false
        })
      }
    );
    const body = await response.json() as { results: unknown[] };

    expect(response.status).toEqual(200);
    expect(body.results).toHaveLength(2);
  });
});
