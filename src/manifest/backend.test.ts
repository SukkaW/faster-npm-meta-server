import { expect, mockFn } from 'earl';
import { describe, it } from 'mocha';
import type { FetchPackageManifests } from '../types';
import { createManifestBackend } from './backend';

describe('manifest fetcher backend', () => {
  it('authenticates, validates, deduplicates, and dispatches one batch', async () => {
    const fetchManifests = mockFn<FetchPackageManifests>((names) => (
      Promise.resolve(names.map(name => ({
        name,
        status: 404,
        error: `${name} missing`
      })))
    ));
    const backend = createManifestBackend({
      fetchManifests,
      token: 'secret'
    });
    const response = await backend(new Request('https://fetcher.example/manifests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        names: ['first', 'first', '@scope/second'],
        force: true
      })
    }));

    expect(response.status).toEqual(200);
    expect(fetchManifests).toHaveBeenCalledWith(
      ['first', '@scope/second'],
      true
    );
    expect(await response.json()).toEqual({
      results: [
        { name: 'first', status: 404, error: 'first missing' },
        {
          name: '@scope/second',
          status: 404,
          error: '@scope/second missing'
        }
      ]
    });
  });

  it('rejects unauthorized and malformed batches without fetching', async () => {
    const fetchManifests = mockFn<FetchPackageManifests>(() => (
      Promise.resolve([])
    ));
    const backend = createManifestBackend({
      fetchManifests,
      token: 'secret'
    });

    const unauthorized = await backend(new Request(
      'https://fetcher.example/manifests',
      {
        method: 'POST',
        body: JSON.stringify({ names: ['fixture'] })
      }
    ));
    expect(unauthorized.status).toEqual(401);

    const malformed = await backend(new Request(
      'https://fetcher.example/manifests',
      {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: JSON.stringify({ names: ['https://example.com'] })
      }
    ));
    expect(malformed.status).toEqual(400);
    expect(fetchManifests).not.toHaveBeenCalled();
  });
});
