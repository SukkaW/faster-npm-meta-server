import type { Request as MiniflareRequest } from 'miniflare';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect } from 'earl';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { after, before, describe, it } from 'mocha';

/**
 * Boots the built dist/snippet.js in workerd (via miniflare) with the npm
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

describe('built worker bundle in workerd', function () {
  this.timeout(120000);

  let mf: Miniflare;

  before(() => {
    execFileSync('pnpm', ['run', 'build'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'ignore'
    });

    mf = new Miniflare({
      scriptPath: 'dist/snippet.js',
      modules: true,
      // keep in sync with wrangler.toml
      compatibilityDate: '2025-03-28',
      outboundService: mockRegistry
    });
  });

  after(() => mf.dispose());

  it('boots and serves the root route', async () => {
    const response = await mf.dispatchFetch('http://localhost/');
    expect(response.status).toEqual(200);
    expect(await response.json() as object).toHaveSubset({ name: 'fast-npm-meta' });
  });

  it('resolves packages through the real bundle', async () => {
    const response = await mf.dispatchFetch('http://localhost/fixture@^1.0.0');
    expect(response.status).toEqual(200);
    expect(await response.json() as object).toHaveSubset({
      name: 'fixture',
      specifier: '^1.0.0',
      version: '1.0.0'
    });
  });

  it('supports force=true (fetch cache mode must be valid in workerd)', async () => {
    const response = await mf.dispatchFetch('http://localhost/fixture?force=true');
    expect(response.status).toEqual(200);
    expect(await response.json() as object).toHaveSubset({
      name: 'fixture',
      version: '2.0.0'
    });
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
});
