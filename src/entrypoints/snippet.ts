import { AppMode, createApp } from '../app';

declare const __DEPLOY_REVISION__: string;
declare const __DEPLOY_TIME__: string;
declare const __FETCHER_BACKENDS__: string[];
declare const __FETCHER_TOKEN__: string;

const app = createApp({
  mode: AppMode.Adaptive,
  backends: typeof __FETCHER_BACKENDS__ === 'object'
    ? __FETCHER_BACKENDS__
    : [],
  backendToken: typeof __FETCHER_TOKEN__ === 'string' && __FETCHER_TOKEN__
    ? __FETCHER_TOKEN__
    : undefined,
  deployRevision: typeof __DEPLOY_REVISION__ === 'string'
    ? __DEPLOY_REVISION__
    : 'development',
  deployTime: typeof __DEPLOY_TIME__ === 'string'
    ? __DEPLOY_TIME__
    : new Date().toISOString()
});

export default {
  fetch: app.fetch
};
