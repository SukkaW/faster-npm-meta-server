import { expect } from 'earl';
import { describe, it } from 'mocha';
import { HttpError } from './errors';
import { handlePackagesQuery } from './packages-query';

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
      async (spec) => {
        started++;
        await gate;
        if (spec.name === 'second') {
          throw new HttpError('second failed', { status: 503 });
        }
        return { name: spec.name! };
      }
    );

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
      spec => Promise.resolve({ name: spec.name! })
    )).toEqual([]);
  });
});
