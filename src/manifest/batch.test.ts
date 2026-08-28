import { expect, mockFn } from 'earl';
import { describe, it } from 'mocha';
import type { FetchPackageManifest, PackageManifest } from '../types';
import { HttpError } from '../errors';
import {
  createAdaptiveManifestBatchFetcher,
  createDelegatedManifestBatchFetcher
} from './batch';

function createManifest(name: string): PackageManifest {
  return {
    name,
    distTags: { latest: '1.0.0' },
    versionsMeta: { '1.0.0': {} },
    timeCreated: '',
    timeModified: '',
    lastSynced: 0
  };
}

describe('adaptive manifest batch fetcher', () => {
  it('fetches a single-package batch directly', async () => {
    const fetchManifest = mockFn<FetchPackageManifest>(name => (
      Promise.resolve(createManifest(name))
    ));
    const fetchRemote = mockFn<typeof fetch>(() => (
      Promise.reject(new TypeError('remote backend should not be called'))
    ));
    const fetchBatch = createAdaptiveManifestBatchFetcher({
      backends: ['https://fetcher.example/manifests'],
      fetchManifest,
      fetch: fetchRemote
    });

    const results = await fetchBatch(['fixture'], true);

    expect(results).toHaveLength(1);
    expect(fetchManifest).toHaveBeenCalledWith('fixture', true);
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it('delegates a multi-package batch in one request', async () => {
    const fetchManifest = mockFn<FetchPackageManifest>(() => (
      Promise.reject(new TypeError('registry should not be called directly'))
    ));
    const fetchRemote = mockFn<typeof fetch>((_input, init) => {
      if (typeof init?.body !== 'string') {
        throw new TypeError('Expected a JSON request body');
      }
      const body = JSON.parse(init.body) as { names: string[] };
      return Promise.resolve(Response.json({
        results: body.names.map(name => ({
          name,
          manifest: createManifest(name)
        }))
      }));
    });
    const fetchBatch = createAdaptiveManifestBatchFetcher({
      backends: ['https://fetcher.example/manifests'],
      fetchManifest,
      fetch: fetchRemote
    });

    const results = await fetchBatch(['first', 'second']);

    expect(results).toHaveLength(2);
    expect(fetchManifest).not.toHaveBeenCalled();
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });
});

describe('delegated manifest batch fetcher', () => {
  it('delegates a single-package batch and forwards force', async () => {
    const fetchRemote = mockFn<typeof fetch>((_input, init) => {
      if (typeof init?.body !== 'string') {
        throw new TypeError('Expected a JSON request body');
      }
      const body = JSON.parse(init.body) as { names: string[] };
      return Promise.resolve(Response.json({
        results: body.names.map(name => ({
          name,
          manifest: createManifest(name)
        }))
      }));
    });
    const fetchBatch = createDelegatedManifestBatchFetcher({
      backends: ['https://fetcher.example/manifests'],
      fetch: fetchRemote
    });

    const results = await fetchBatch(['fixture'], true);

    expect(results).toHaveLength(1);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
    const init = fetchRemote.calls[0].args[1];
    if (typeof init?.body !== 'string') {
      throw new TypeError('Expected a JSON request body');
    }
    expect(JSON.parse(init.body)).toEqual({
      names: ['fixture'],
      force: true
    });
  });

  it('delegates a multi-package batch with one request to the selected backend', async () => {
    const fetchRemote = mockFn<typeof fetch>((_input, init) => {
      if (typeof init?.body !== 'string') {
        throw new TypeError('Expected a JSON request body');
      }
      const body = JSON.parse(init.body) as {
        names: string[],
        force: boolean
      };
      return Promise.resolve(Response.json({
        results: body.names.map(name => ({
          name,
          manifest: createManifest(name)
        }))
      }));
    });
    const fetchBatch = createDelegatedManifestBatchFetcher({
      backends: [
        'https://fetcher-a.example/manifests',
        '  ',
        ' https://fetcher-b.example/manifests/ '
      ],
      token: 'secret',
      fetch: fetchRemote,
      selectBackend: backends => backends[1]
    });

    const results = await fetchBatch(['first', 'second'], true);

    expect(results).toHaveLength(2);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
    const [input, init] = fetchRemote.calls[0].args;
    expect(input).toEqual('https://fetcher-b.example/manifests');
    expect(init?.method).toEqual('POST');
    expect(new Headers(init?.headers).get('authorization')).toEqual('Bearer secret');
    if (typeof init?.body !== 'string') {
      throw new TypeError('Expected a JSON request body');
    }
    expect(JSON.parse(init.body)).toEqual({
      names: ['first', 'second'],
      force: true
    });
  });

  it('does not call a backend for an empty batch', async () => {
    const fetchRemote = mockFn<typeof fetch>(() => (
      Promise.reject(new TypeError('remote backend should not be called'))
    ));
    const fetchBatch = createDelegatedManifestBatchFetcher({
      backends: ['https://fetcher.example/manifests'],
      fetch: fetchRemote
    });

    expect(await fetchBatch([])).toEqual([]);
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it('requires a backend for every non-empty batch', async () => {
    const fetchBatch = createDelegatedManifestBatchFetcher({ backends: [] });
    const error = await captureError(fetchBatch(['fixture']));

    expect(error).toBeA(HttpError);
    expect((error as HttpError).status).toEqual(503);
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
