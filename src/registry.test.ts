import { expect, mockFn } from 'earl';
import { afterEach, describe, it } from 'mocha';
import sinon from 'sinon';
import { HttpError } from './errors';
import { createManifestFetcher } from './registry';

interface TestRequestInit extends RequestInit<RequestInitCfProperties> {
  cache?: RequestCache
}

type TestFetch = (
  input: RequestInfo | URL,
  init?: TestRequestInit
) => Promise<Response>;

afterEach(() => {
  sinon.restore();
});

/**
 * The registry module calls the global `fetch`, so tests swap it out. sinon
 * owns the replace/restore lifecycle; earl still owns the mock and its
 * assertions.
 */
function stubFetch(implementation: TestFetch) {
  const mock = mockFn<TestFetch>(implementation);
  sinon.replace(globalThis, 'fetch', mock);
  return mock;
}

function createPackument() {
  return {
    name: 'fixture',
    'dist-tags': {
      latest: '1.0.0'
    },
    versions: {
      '1.0.0': {
        engines: {
          node: '>=18'
        },
        dist: {
          integrity: 'sha512-fixture',
          attestations: {
            provenance: {}
          }
        },
        _npmUser: {
          trustedPublisher: {}
        }
      }
    },
    time: {
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      '1.0.0': '2024-01-01T00:00:00.000Z'
    }
  };
}

describe('registry manifest fetcher', () => {
  it('preserves upstream freshness while using Cloudflare fetch caching', async () => {
    // only `Date` is faked — the cache compares timestamps, and faking timers
    // would interfere with the awaited promises below
    const clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const fetchMock = stubFetch(() => Promise.resolve(Response.json(createPackument())));
    const fetchManifest = createManifestFetcher();

    const first = await fetchManifest('fixture');
    const metadata = first.versionsMeta['1.0.0'];
    expect(metadata).toHaveSubset({
      engines: { node: '>=18' },
      integrity: 'sha512-fixture',
      provenance: true,
      trustedPublisher: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fetchManifest('fixture');
    clock.tick(10000);
    await fetchManifest('fixture', true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // past the 30s force cache window
    clock.tick(30001);
    await fetchManifest('fixture', true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstInit = fetchMock.calls[0].args[1];
    if (!firstInit?.cf) {
      throw new Error('Expected Cloudflare fetch options');
    }
    const forcedInit = fetchMock.calls[1].args[1];
    expect(firstInit.cf).toHaveSubset({
      cacheEverything: true,
      cacheTtlByStatus: {
        '200-299': 900,
        404: 900,
        '500-599': 0
      }
    });
    expect(forcedInit?.cache).toEqual('no-store');
    expect(new Headers(firstInit.headers).get('user-agent')).toEqual('get-npm-meta');
  });

  it('deduplicates concurrent registry requests', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    const fetchManifest = createManifestFetcher();

    const first = fetchManifest('fixture');
    const second = fetchManifest('fixture');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse!(Response.json(createPackument()));
    expect(await Promise.all([first, second])).toHaveLength(2);
  });

  it('retries once on transient failures like upstream ofetch', async () => {
    let attempts = 0;
    const fetchMock = stubFetch(() => {
      attempts++;
      if (attempts === 1) {
        return Promise.resolve(new Response(null, {
          status: 503,
          statusText: 'Service Unavailable'
        }));
      }
      return Promise.resolve(Response.json(createPackument()));
    });
    const fetchManifest = createManifestFetcher();

    const manifest = await fetchManifest('fixture');
    expect(manifest.name).toEqual('fixture');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on network errors like upstream ofetch', async () => {
    let attempts = 0;
    const fetchMock = stubFetch(() => {
      attempts++;
      if (attempts === 1) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return Promise.resolve(Response.json(createPackument()));
    });
    const fetchManifest = createManifestFetcher();

    const manifest = await fetchManifest('fixture');
    expect(manifest.name).toEqual('fixture');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves upstream cached-error behavior', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(null, {
      status: 404,
      statusText: 'Not Found'
    })));
    const fetchManifest = createManifestFetcher();

    const firstError = await captureError(fetchManifest('missing'));
    const secondError = await captureError(fetchManifest('missing'));

    expect(firstError).toBeA(HttpError);
    expect((firstError as HttpError).status).toEqual(404);
    expect(secondError).toBeA(Error);
    expect(secondError).not.toBeA(HttpError);
    expect((secondError as Error).message).toEqual(
      '[GET] "https://registry.npmjs.org/missing": 404 Not Found'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
