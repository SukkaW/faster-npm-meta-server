import type { App } from 'lemmih';
import { expect, mockFn } from 'earl';
import { describe, it } from 'mocha';
import { createApp } from './app';
import {
  CACHEABLE,
  CACHEABLE_ERROR,
  CACHEABLE_INDEX,
  NO_STORE
} from './cache-control';
import { REPOSITORY_URL, SERVICE_NAME } from './constants';
import { HttpError } from './errors';
import type {
  FetchPackageManifest,
  PackageManifest
} from './types';

const allVersions = [
  '1.0.0',
  '1.5.0',
  '2.0.0',
  '2.1.0',
  '3.0.0-beta.1'
];

const fixture: PackageManifest = {
  name: 'fixture',
  distTags: {
    latest: '2.1.0',
    next: '3.0.0-beta.1',
    stable: '2.0.0'
  },
  versionsMeta: {
    '1.0.0': {
      time: '2024-01-01T00:00:00.000Z',
      engines: { node: '>=18' }
    },
    '1.5.0': {
      time: '2024-06-01T00:00:00.000Z',
      deprecated: 'Use version 2'
    },
    '2.0.0': {
      time: '2025-01-01T00:00:00.000Z',
      integrity: 'sha512-fixture'
    },
    '2.1.0': {
      time: '2025-06-01T00:00:00.000Z',
      provenance: true
    },
    '3.0.0-beta.1': {
      time: '2025-07-01T00:00:00.000Z'
    }
  },
  timeCreated: '2024-01-01T00:00:00.000Z',
  timeModified: '2025-07-01T00:00:00.000Z',
  lastSynced: 1_750_000_000_000
};

function setup() {
  const fetchManifest = mockFn<FetchPackageManifest>((name) => {
    if (name === 'missing') {
      return Promise.reject(new HttpError(
        'Package missing not found',
        { status: 404 }
      ));
    }
    return Promise.resolve({
      ...fixture,
      name
    });
  });
  const app = createApp({
    deployRevision: 'test-revision',
    deployTime: '2026-07-31T00:00:00.000Z',
    fetchManifest
  });

  return { app, fetchManifest };
}

describe('Hono API upstream parity', () => {
  it('reports upstream service metadata through Hono', async () => {
    const { app } = setup();
    const response = await appRequest(app, '/');

    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({
      name: SERVICE_NAME,
      version: '0.0.0-latest-test-re-20260731',
      docs: REPOSITORY_URL,
      deployTime: '2026-07-31T00:00:00.000Z',
      deployRevision: `${REPOSITORY_URL}/commit/test-revision`
    });
    expect(response.headers.get('access-control-allow-origin')).toEqual('*');
    expect(response.headers.get('access-control-expose-headers')).toEqual('*');
    expect(response.headers.get('cache-control')).toEqual(CACHEABLE_INDEX);
  });

  it('sets an edge-cacheable Cache-Control so a CDN can front the Worker', async () => {
    const { app } = setup();

    // a plain hit is cacheable for the full manifest TTL
    expect((await appRequest(app, '/fixture')).headers.get('cache-control'))
      .toEqual(CACHEABLE);
    expect((await appRequest(app, '/versions/fixture')).headers.get('cache-control'))
      .toEqual(CACHEABLE);
    expect((await appRequest(app, '/full/fixture')).headers.get('cache-control'))
      .toEqual(CACHEABLE);

    // force must never be stored, or it could not bypass anything
    expect((await appRequest(app, '/fixture?force=true')).headers.get('cache-control'))
      .toEqual(NO_STORE);

    // thrown errors and embedded per-package errors both get the short TTL
    expect((await appRequest(app, '/missing')).headers.get('cache-control'))
      .toEqual(CACHEABLE_ERROR);
    expect((await appRequest(app, '/missing?throw=false')).headers.get('cache-control'))
      .toEqual(CACHEABLE_ERROR);
    expect((await appRequest(app, '/fixture+missing?throw=false')).headers.get('cache-control'))
      .toEqual(CACHEABLE_ERROR);
  });

  it('resolves latest, ranges, tags, exact versions, and metadata', async () => {
    const { app } = setup();

    await expectJson(appRequest(app, '/fixture'), {
      name: 'fixture',
      specifier: 'latest',
      version: '2.1.0',
      publishedAt: '2025-06-01T00:00:00.000Z'
    });
    await expectJson(appRequest(app, '/fixture@^1.0.0'), {
      specifier: '^1.0.0',
      version: '1.5.0'
    });
    await expectJson(appRequest(app, '/fixture@stable'), {
      specifier: 'stable',
      version: '2.0.0'
    });
    await expectJson(appRequest(app, '/fixture@v2.0.0?metadata=true'), {
      version: '2.0.0',
      integrity: 'sha512-fixture'
    });
  });

  it('preserves missing-tag behavior from upstream', async () => {
    const { app } = setup();
    const response = await appRequest(app, '/fixture@unknown-tag');

    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({
      name: 'fixture',
      specifier: 'unknown-tag',
      lastSynced: fixture.lastSynced
    });
  });

  it('handles scoped packages and ordered partial batch failures', async () => {
    const { app } = setup();
    const response = await appRequest(app, '/@scope/pkg+missing+fixture?throw=false');
    const result = await response.json<Array<Record<string, unknown>>>();

    expect(response.status).toEqual(200);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveSubset({ name: '@scope/pkg', version: '2.1.0' });
    expect(result[1]).toEqual({
      status: 404,
      name: 'missing',
      error: 'Package missing not found'
    });
    expect(result[2]).toHaveSubset({ name: 'fixture', version: '2.1.0' });
  });

  it('returns an HTTP error in the h3/nitro JSON shape by default', async () => {
    const { app } = setup();
    const response = await appRequest(app, '/missing');

    expect(response.status).toEqual(404);
    expect(await response.json()).toEqual({
      error: true,
      url: 'http://localhost/missing',
      statusCode: 404,
      statusMessage: 'Server Error',
      message: 'Package missing not found'
    });
  });

  it('treats a double-encoded plus as part of a single spec', async () => {
    // https://github.com/antfu/node-modules-inspector/issues/109
    const { app } = setup();
    const response = await appRequest(app, '/fixture@8.4.31%252Bfixture@18.2.0?throw=false');
    const result = await response.json<Record<string, unknown>>();

    expect(response.status).toEqual(200);
    expect(Array.isArray(result)).toEqual(false);
    expect(result).toHaveSubset({
      status: 400,
      name: 'fixture@8.4.31+fixture@18.2.0'
    });
  });

  it('preserves upstream versions filtering behavior', async () => {
    const { app } = setup();

    await expectJson(appRequest(app, '/versions/fixture@^1'), {
      specifier: '^1',
      versions: ['1.0.0', '1.5.0']
    });
    await expectJson(appRequest(app, '/versions/fixture@^1?loose=true'), {
      specifier: '^1',
      versions: allVersions
    });
    await expectJson(appRequest(app, '/versions/fixture@^4?loose=true'), {
      specifier: '^4',
      versions: []
    });
    await expectJson(appRequest(app, '/versions/fixture@2.0.0'), {
      versions: allVersions
    });
    await expectJson(appRequest(app, '/versions/fixture@stable'), {
      versions: ['2.0.0']
    });
    await expectJson(appRequest(app, '/versions/fixture@missing-tag'), {
      versions: allVersions
    });
    await expectJson(appRequest(app, '/versions/fixture?after=2025-01-01T00:00:00Z'), {
      versions: ['2.1.0', '3.0.0-beta.1']
    });
    await expectJson(appRequest(app, '/versions/fixture?after=not-a-date'), {
      versions: allVersions
    });
    await expectJson(appRequest(app, '/versions/fixture?after=1735689600000'), {
      versions: allVersions
    });
  });

  it('returns the reduced full manifest and metadata form', async () => {
    const { app } = setup();

    await expectJson(appRequest(app, '/full/fixture'), {
      name: 'fixture',
      versionsMeta: fixture.versionsMeta
    });

    const response = await appRequest(app, '/versions/fixture@^1?metadata=true');
    const result = await response.json<Record<string, unknown>>();
    expect('versions' in result).toEqual(false);
    expect(result).toHaveSubset({
      name: 'fixture',
      versionsMeta: {
        '1.0.0': fixture.versionsMeta['1.0.0'],
        '1.5.0': fixture.versionsMeta['1.5.0']
      }
    });
  });

  it('uses upstream query truthiness', async () => {
    const { app, fetchManifest } = setup();
    const response = await appRequest(app, '/versions/fixture?force=false&metadata=false&loose=false');
    const result = await response.json<Record<string, unknown>>();

    expect('versionsMeta' in result).toEqual(true);
    expect(fetchManifest.calls[0].args[1]).toEqual(true);
  });

  it('does not add a batch-size or concurrency policy', async () => {
    const { app } = setup();
    const specs: string[] = [];
    for (let index = 0; index < 40; index++) {
      specs.push(`fixture-${index}`);
    }
    const batch = specs.join('+');
    const response = await appRequest(app, `/${batch}`);

    expect(response.status).toEqual(200);
    expect(await response.json<unknown[]>()).toHaveLength(40);
  });

  it('keeps Nitro method-agnostic routes method-agnostic in Hono', async () => {
    const { app } = setup();
    const response = await appRequest(app, '/fixture', {
      method: 'POST'
    });

    expect(response.status).toEqual(200);
  });
});

function appRequest(app: App, path: string, init?: RequestInit): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

async function expectJson(
  responsePromise: Response | Promise<Response>,
  expected: Record<string, unknown>
): Promise<void> {
  const response = await responsePromise;
  expect(response.status).toEqual(200);
  const result = await response.json<Record<string, unknown>>();
  expect(result).toHaveSubset(expected);
}
