import { createApp } from './app';

declare const __DEPLOY_REVISION__: string;
declare const __DEPLOY_TIME__: string;

const deployRevision = typeof __DEPLOY_REVISION__ === 'string'
  ? __DEPLOY_REVISION__
  : 'development';
const deployTime = typeof __DEPLOY_TIME__ === 'string'
  ? __DEPLOY_TIME__
  : new Date().toISOString();

export const app = createApp({
  deployRevision,
  deployTime
});

export default {
  fetch: app.fetch
};
