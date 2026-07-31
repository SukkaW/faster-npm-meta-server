import { expect } from 'earl';
import { describe, it } from 'mocha';
import { createApp } from '../src/app';

/**
 * Live parity check against the upstream deployment. Opt-in because it hits
 * the network on both sides (`pnpm test:live`).
 *
 * Both sides resolve from the live npm registry, but upstream serves from a
 * cache of up to 15 minutes, so a publish landing inside that window can
 * cause a transient distTags mismatch. Specs below pin versions or hit
 * stable error paths to keep that risk negligible.
 */
const UPSTREAM = 'https://npm.antfu.dev';

const CASES = [
  '/vite@2',
  '/axios@150.150.150',
  '/axios@150.150.150?throw=false',
  '/@antfu/some-private-package',
  '/@antfu/some-private-package?throw=false',
  '/vite@%3E=2.0.0%20%3C3.0.0?throw=false',
  '/es5-ext@0.10.53+react@18.0.0?throw=false',
  '/postcss@8.4.31%2Breact@18.2.0?throw=false',
  // double-encoded plus stays inside a single spec
  // https://github.com/antfu/node-modules-inspector/issues/109
  '/postcss@8.4.31%252Breact@18.2.0?throw=false',
  '/vite@5.0%20-%205.4?throw=false',
  '/vite@=7.0.3?throw=false',
  '/vite@nonexistent-tag?throw=false',
  '/versions/vite@5?throw=false',
  '/versions/vite@5&loose=true?throw=false'
];

const LIVE = process.env.LIVE_PARITY === '1'
  || process.env.LIVE_PARITY === 'true';

(LIVE ? describe : describe.skip)(
  'live parity against npm.antfu.dev (LIVE_PARITY=1 to enable)',
  function (this: Mocha.Suite) {
    this.timeout(30000);

    const app = createApp();

    for (const path of CASES) {
      it(`matches upstream for ${path}`, async () => {
        const [local, upstream] = await Promise.all([
          app.fetch(new Request(`http://localhost${path}`)),
          fetch(UPSTREAM + path)
        ]);

        expect(local.status).toEqual(upstream.status);
        expect(normalize(await local.json()))
          .toEqual(normalize(await upstream.json()));
      });
    }
  }
);

// strip fields that legitimately differ between deployments
function normalize(body: unknown): unknown {
  return JSON.parse(JSON.stringify(body, (key, value: unknown) => {
    if (key === 'lastSynced') {
      return 'LAST_SYNCED';
    }
    if (key === 'url') {
      return 'URL';
    }
    return value;
  }));
}
