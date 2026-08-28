# faster-npm-meta-server

A re-implementation of [antfu/fast-npm-meta](https://github.com/antfu/fast-npm-meta)'s server that is tiny, lightweight, fast, and simple enough to run in Cloudflare Workers without any storage bindings (KV, D1, etc). It can also run as a Cloudflare Snippet backed by a pool of manifest-fetcher services.

The build produces three self-contained bundles: a normal Worker, a Snippet front end, and a small manifest-fetcher backend.

It is a drop-in replacement for the upstream server: same routes, same response shapes, same error format (including the same error JSON format with `h3/nitro` for best compatibility), so the official [`fast-npm-meta`](https://www.npmjs.com/package/fast-npm-meta) npm client works unchanged — just point its `apiEndpoint` at your deployment.

## API

You can access the example server at [https://npm.skk.moe](https://npm.skk.moe).

Get the resolved version of a package:

```
GET /:pkg             # /foxact          -> latest
GET /:pkg@tag         # /foxact@latest
GET /:pkg@range       # /foxact@^0.3.0, /foxts@5, /foxts@>=5.0.0
GET /:pkg@version     # /foxact@0.3.8    -> 404 if the exact version doesn't exist
```

```json
{
  "name": "foxact",
  "specifier": "latest",
  "version": "0.3.8",
  "publishedAt": "2026-06-22T17:25:42.615Z",
  "lastSynced": 1785568779888
}
```

Get all versions of a package:

```
GET /versions/:pkg    # /versions/foxts@5
```

Get the condensed manifest (dist-tags, per-version time / engines / deprecation / integrity / provenance):

```
GET /full/:pkg
```

Multiple packages can be queried in one request by joining specs with `+` (a literal `+` inside a spec, e.g. build metadata, must be double-encoded as `%252B`):

```
GET /foxact+foxts@5+cors-edge
```

Query parameters:

| Param           | Applies to           | Description                                                   |
| --------------- | -------------------- | ------------------------------------------------------------- |
| `metadata=true` | resolve, `/versions` | include engines, deprecation, integrity, provenance, etc.     |
| `loose=true`    | `/versions`          | also include versions newer than the given range              |
| `after=<date>`  | `/versions`          | only versions published after this date/timestamp             |
| `force=true`    | all                  | shorten the server-side cache window (30 s instead of 15 min) |
| `throw=false`   | all                  | return per-package error objects instead of an HTTP error     |

## Deployment

You can deploy `faster-npm-meta-server` in `Local`, `Adaptive`, or `Delegate` mode:

- `Local` mode: you run a single self-contained serverless service that connects to npm registry directly.
- `Adaptive` mode: single-package requests connect to npm registry directly, while package batches use a pool of manifest-fetcher backends.
- `Delegate` mode: you run a public-facing service, and instead of connecting to npm registry directly, it connects to a pool of manifest-fetcher backends and delegates all npm metadata fetch requests to a pool of backends. This architecture allows you to fan out npm metadata requests to multiple backends.

### Local mode

Local mode uses a single public-facing service:

```text
Client → faster-npm-meta → npm registry
```

This is the default mode and the recommended deployment for Cloudflare Workers or any runtime whose subrequest allowance can accommodate package batches. It has the fewest components to deploy and operate.

Build and deploy `dist/worker.js`. Programmatic users may select the mode explicitly, although `createApp()` already defaults to it:

```ts
import { AppMode, createApp } from './src/app';

const implicitLocal = createApp();
const explicitLocal = createApp({ mode: AppMode.Local });
```

The tradeoff is that npm registry requests count against the public-facing runtime's own subrequest allowance.

### Adaptive mode

Adaptive mode combines direct registry access with a fetcher backend pool:

```text
Single package: Client → faster-npm-meta frontend → npm registry
Package batch:  Client → faster-npm-meta frontend → fetcher backend pool → npm registry
```

This is the recommended deployment for Cloudflare Snippets. It keeps a single-package request self-contained and uses one backend subrequest for a package batch. Build and deploy `dist/snippet.js` for this mode.

Adaptive mode requires at least one backend URL to serve package batches:

```ts
import { AppMode, createApp } from './src/app';

const app = createApp({
  mode: AppMode.Adaptive,
  backends: [
    'https://fetcher-a.example.com/manifests',
    'https://fetcher-b.example.com/manifests'
  ],
  backendToken: 'shared-secret'
});
```

### Delegate mode

Delegate mode separates the public API from registry access:

```text
Client → faster-npm-meta "frontend" → fetcher backend pool → npm registry
```

Delegate mode requires at least one backend URL. Multiple URLs form a pool, allowing registry traffic to be distributed across many service providers.

```ts
import { AppMode, createApp } from './src/app';

const app = createApp({
  mode: AppMode.Delegate,
  backends: [
    'https://fetcher-a.example.com/manifests',
    'https://fetcher-b.example.com/manifests'
  ],
  backendToken: 'shared-secret'
});
```

The fetcher backend is a private architectural component of Adaptive and Delegate modes that implements the manifest backend protocol:

```http
POST /manifests
Authorization: Bearer shared-secret
Content-Type: application/json

{"names":["vite","@antfu/utils"],"force":false}
```

```json
{
  "results": [
    {
      "name": "vite",
      "manifest": {
        "name": "vite",
        "distTags": { "latest": "7.0.0" },
        "versionsMeta": {
          "7.0.0": { "time": "2025-06-24T00:00:00.000Z" }
        },
        "timeCreated": "2020-04-21T00:00:00.000Z",
        "timeModified": "2025-06-24T00:00:00.000Z",
        "lastSynced": 1750723200000
      }
    },
    { "name": "@antfu/utils", "status": 404, "error": "..." }
  ]
}
```

Authentication is optional:

- To run without authentication, leave both `MANIFEST_BACKEND_TOKEN` and `FETCHER_TOKEN` unset.
- To enable authentication, set `MANIFEST_BACKEND_TOKEN` on every fetcher and build the Snippet with the same value in `FETCHER_TOKEN`.

If the values do not match, delegated requests fail. An unauthenticated fetcher is publicly callable unless access is restricted elsewhere.

## Development

Source layout:

```text
src/
├── entrypoints/  # worker.ts, snippet.ts, fetcher.ts → dist/*.js
├── manifest/     # registry access, batch strategies, backend protocol
└── *.ts          # shared HTTP routing, package parsing, and result shaping
```

```bash
pnpm dev            # wrangler dev against src/entrypoints/worker.ts
pnpm build          # build worker, snippet, and fetcher bundles
pnpm build:worker   # dist/worker.js
pnpm build:snippet  # dist/snippet.js (uses FETCHER_BACKENDS/FETCHER_TOKEN)
pnpm build:fetcher  # dist/fetcher.js
pnpm build:analyze  # build + bundle size breakdown (stats.html)
pnpm deploy         # build + wrangler deploy
pnpm deploy:fetcher # build + deploy the manifest backend
pnpm lint
pnpm typecheck
```

### Testing

```bash
pnpm test           # everything below except live parity
pnpm test:live      # opt-in: compares responses against the live npm.antfu.dev to ensure behavior parity
```

## Credits

API design, response shapes, and the original implementation are from [antfu/fast-npm-meta](https://github.com/antfu/fast-npm-meta).

----

**faster-npm-meta-server** © [Sukka](https://github.com/SukkaW), Released under the [MIT](./LICENSE) License.
Authored and maintained by Sukka with help from contributors ([list](https://github.com/SukkaW/faster-npm-meta-server/graphs/contributors)).

> [Personal Website](https://skk.moe) · [Blog](https://blog.skk.moe) · GitHub [@SukkaW](https://github.com/SukkaW) · Telegram Channel [@SukkaChannel](https://t.me/SukkaChannel) · Mastodon [@sukka@acg.mn](https://acg.mn/@sukka) · Twitter [@isukkaw](https://twitter.com/isukkaw) · BlueSky [@skk.moe](https://bsky.app/profile/skk.moe)

<p align="center">
  <a href="https://github.com/sponsors/SukkaW/">
    <img src="https://sponsor.cdn.skk.moe/sponsors.svg"/>
  </a>
</p>
