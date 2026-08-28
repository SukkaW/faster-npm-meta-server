import { expect } from 'earl';
import { describe, it } from 'mocha';
import { HttpError } from './errors';
import { handlePackagesQuery } from './packages-query';
import type { FetchPackageManifests, PackageManifest } from './types';

const fetchManifests: FetchPackageManifests = names => Promise.resolve(
  names.map(name => ({ name, manifest: createManifest(name) }))
);

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

describe('handlePackagesQuery upstream parity', () => {
  it('starts the full batch without a queue and preserves result order', async () => {
    let started = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const resultPromise = handlePackagesQuery(
      'first+second+third',
      { throw: 'false' },
      fetchManifests,
      async (spec) => {
        started++;
        await gate;
        if (spec.name === 'second') {
          throw new HttpError('second failed', { status: 503 });
        }
        return { name: spec.name! };
      }
    );

    await Promise.resolve();
    expect(started).toEqual(3);
    release!();
    expect(await resultPromise).toEqual([
      { name: 'first' },
      {
        status: 503,
        name: 'second',
        error: 'second failed'
      },
      { name: 'third' }
    ]);
  });

  it('returns an empty array for an empty normalized batch', async () => {
    expect(await handlePackagesQuery(
      '+++',
      {},
      fetchManifests,
      spec => Promise.resolve({ name: spec.name! })
    )).toEqual([]);
  });

  it('fetches all unique package names in one batch before handling specs', async () => {
    let fetchedNames: readonly string[] = [];
    let forced = false;
    let handled = 0;

    const result = await handlePackagesQuery(
      'first@1+first@2+second',
      { force: 'true' },
      (names, force) => {
        fetchedNames = names;
        forced = Boolean(force);
        return fetchManifests(names, force);
      },
      (spec, _query, manifest) => {
        handled++;
        return { spec: spec.raw, manifest: manifest.name };
      }
    );

    expect(fetchedNames).toEqual(['first', 'second']);
    expect(forced).toEqual(true);
    expect(handled).toEqual(3);
    expect(result).toEqual([
      { spec: 'first@1', manifest: 'first' },
      { spec: 'first@2', manifest: 'first' },
      { spec: 'second', manifest: 'second' }
    ]);
  });
});
