import validateNpmPackageName from 'validate-npm-package-name';
import type { FetchPackageManifests } from '../types';
import { MANIFEST_BATCH_PATH, fetchPackageManifests } from './batch';

export interface ManifestBackendOptions {
  fetchManifests?: FetchPackageManifests,
  token?: string
}

interface ManifestBatchRequest {
  names: string[],
  force: boolean
}

export function createManifestBackend(
  options: ManifestBackendOptions = {}
): (request: Request) => Promise<Response> {
  const fetchManifests = options.fetchManifests ?? fetchPackageManifests;

  return async (request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return Response.json({
        name: 'faster-npm-meta-fetcher',
        protocol: MANIFEST_BATCH_PATH
      });
    }

    if (request.method !== 'POST' || url.pathname !== MANIFEST_BATCH_PATH) {
      return Response.json({ error: 'Not Found' }, {
        status: 404,
        headers: { 'cache-control': 'no-store' }
      });
    }

    if (
      options.token
      && request.headers.get('authorization') !== `Bearer ${options.token}`
    ) {
      return Response.json({ error: 'Unauthorized' }, {
        status: 401,
        headers: { 'cache-control': 'no-store' }
      });
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return invalidRequest('Request body must be valid JSON');
    }

    const batch = parseManifestBatchRequest(input);
    if (typeof batch === 'string') {
      return invalidRequest(batch);
    }

    const results = await fetchManifests(batch.names, batch.force);
    return Response.json({ results }, {
      headers: { 'cache-control': 'no-store' }
    });
  };
}

function parseManifestBatchRequest(input: unknown): ManifestBatchRequest | string {
  if (!input || typeof input !== 'object' || !('names' in input)) {
    return 'Request body must contain a names array';
  }
  if (!Array.isArray(input.names)) {
    return 'Request body names must be an array';
  }
  if (
    'force' in input
    && input.force !== undefined
    && typeof input.force !== 'boolean'
  ) {
    return 'Request body force must be a boolean';
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (let index = 0, len = input.names.length; index < len; index++) {
    const name: unknown = input.names[index];
    if (
      typeof name !== 'string'
      || !validateNpmPackageName(name).validForOldPackages
    ) {
      return `Invalid npm package name at index ${index}`;
    }
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return {
    names,
    force: 'force' in input && input.force === true
  };
}

function invalidRequest(message: string): Response {
  return Response.json({ error: message }, {
    status: 400,
    headers: { 'cache-control': 'no-store' }
  });
}
