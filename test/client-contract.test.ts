import { expect } from 'earl';
import {
  getLatestVersion,
  getLatestVersionBatch,
  getVersions
} from 'fast-npm-meta';
import { describe, it } from 'mocha';
import { createApp } from '../src/app';
import { HttpError } from '../src/errors';
import type {
  FetchPackageManifest,
  PackageManifest
} from '../src/types';

const fixture: PackageManifest = {
  name: 'fixture',
  distTags: {
    latest: '2.1.0',
    next: '3.0.0-beta.1'
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

const fetchManifest: FetchPackageManifest = (name) => {
  if (name === 'missing') {
    return Promise.reject(new HttpError(
      '[GET] "https://registry.npmjs.org/missing": 404 Not Found',
      { status: 404 }
    ));
  }
  return Promise.resolve({ ...fixture, name });
};

function setup() {
  const app = createApp({ fetchManifest });

  // the official client accepts a custom fetch, so requests go straight to
  // the app without a listening server
  return {
    apiEndpoint: 'http://localhost/',
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch,
    retry: false as const
  };
}

describe('official fast-npm-meta client against the Hono server', () => {
  it('resolves versions through the client', async () => {
    const options = setup();

    expect(await getLatestVersion('fixture', options)).toHaveSubset({
      name: 'fixture',
      specifier: 'latest',
      version: '2.1.0',
      publishedAt: '2025-06-01T00:00:00.000Z'
    });

    expect(await getLatestVersion('fixture@^1.0.0', {
      ...options,
      metadata: true
    })).toHaveSubset({
      version: '1.5.0',
      deprecated: 'Use version 2'
    });
  });

  it('throws the server error message for failed packages', async () => {
    const options = setup();

    const notFound = await captureError(getLatestVersion('missing', options));
    expect(notFound).toBeA(Error);
    expect((notFound as Error).message).toEqual(
      '[GET] "https://registry.npmjs.org/missing": 404 Not Found'
    );

    const badVersion = await captureError(getLatestVersion('fixture@9.9.9', options));
    expect(badVersion).toBeA(Error);
    expect((badVersion as Error).message).toEqual(
      'Version 9.9.9 of package fixture not found'
    );
  });

  it('returns error objects in order with throw disabled', async () => {
    const options = setup();

    expect(await getLatestVersion('missing', {
      ...options,
      throw: false
    })).toEqual({
      status: 404,
      name: 'missing',
      error: '[GET] "https://registry.npmjs.org/missing": 404 Not Found'
    });

    const batch = await getLatestVersionBatch(
      ['fixture@2', 'missing', 'fixture@next'],
      { ...options, throw: false }
    );
    expect(batch).toHaveLength(3);
    expect(batch[0]).toHaveSubset({ name: 'fixture', version: '2.1.0' });
    expect(batch[1]).toHaveSubset({ status: 404, name: 'missing' });
    expect(batch[2]).toHaveSubset({
      name: 'fixture',
      version: '3.0.0-beta.1'
    });
  });

  it('fetches version lists and metadata through the client', async () => {
    const options = setup();

    expect(await getVersions('fixture@^1', options)).toHaveSubset({
      name: 'fixture',
      specifier: '^1',
      versions: ['1.0.0', '1.5.0']
    });

    const withMetadata = await getVersions('fixture@^1', {
      ...options,
      metadata: true
    });
    expect('versions' in withMetadata).toEqual(false);
    expect(withMetadata).toHaveSubset({
      versionsMeta: {
        '1.0.0': fixture.versionsMeta['1.0.0'],
        '1.5.0': fixture.versionsMeta['1.5.0']
      }
    });
  });
});

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}
