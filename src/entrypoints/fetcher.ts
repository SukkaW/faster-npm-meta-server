import { createManifestBackend } from '../manifest/backend';

interface FetcherEnv {
  MANIFEST_BACKEND_TOKEN?: string
}

export default {
  fetch(request: Request, env: FetcherEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/.well-known' || pathname.startsWith('/.well-known/')) {
      return fetch(request);
    }
    return createManifestBackend({
      token: env.MANIFEST_BACKEND_TOKEN
    })(request);
  }
};
