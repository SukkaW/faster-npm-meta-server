import { expect } from 'earl';
import { describe, it } from 'mocha';
import {
  CACHEABLE,
  CACHEABLE_ERROR,
  cacheControlForErrorStatus,
  cacheControlForResults,
  NO_STORE
} from './cache-control';

describe('cache-control policy', () => {
  it('caches successful results for the manifest TTL', () => {
    expect(CACHEABLE).toEqual('public, max-age=900');
    expect(cacheControlForResults(false, { name: 'foxts', version: '5.8.1' }))
      .toEqual(CACHEABLE);
    expect(cacheControlForResults(false, [
      { name: 'foxts', version: '5.8.1' },
      { name: 'foxact', version: '0.3.8' }
    ])).toEqual(CACHEABLE);
  });

  it('never stores a response for ?force=true', () => {
    // force exists to bypass caches; a stored response would defeat it
    expect(cacheControlForResults(true, { name: 'foxts', version: '5.8.1' }))
      .toEqual(NO_STORE);
    expect(cacheControlForErrorStatus(true, 404)).toEqual(NO_STORE);
  });

  it('shortens the TTL for throw=false bodies carrying an error', () => {
    expect(CACHEABLE_ERROR).toEqual('public, max-age=60');
    expect(cacheControlForResults(false, {
      status: 404,
      name: 'nope',
      error: 'not found'
    })).toEqual(CACHEABLE_ERROR);
    // a batch is only as cacheable as its worst entry
    expect(cacheControlForResults(false, [
      { name: 'foxts', version: '5.8.1' },
      { status: 404, name: 'nope', error: 'not found' }
    ])).toEqual(CACHEABLE_ERROR);
  });

  it('briefly caches client errors but never server errors', () => {
    expect(cacheControlForErrorStatus(false, 400)).toEqual(CACHEABLE_ERROR);
    expect(cacheControlForErrorStatus(false, 404)).toEqual(CACHEABLE_ERROR);
    expect(cacheControlForErrorStatus(false, 500)).toEqual(NO_STORE);
    expect(cacheControlForErrorStatus(false, 503)).toEqual(NO_STORE);
  });
});
