import { createManifestBackend } from '../manifest/backend';

interface FetcherEnv {
  MANIFEST_BACKEND_TOKEN?: string
}

export default {
  fetch(request: Request, env: FetcherEnv): Promise<Response> {
    return createManifestBackend({
      token: env.MANIFEST_BACKEND_TOKEN
    })(request);
  }
};
