# faster-npm-meta-server

A re-implementation of [antfu/fast-npm-meta](https://github.com/antfu/fast-npm-meta)'s server that is tiny, lightweight, fast, and simple enough to run in Cloudflare Workers without any bindings (KV, D1, etc).

The entire server builds into a single self-contained ~22 KiB bundle.

It is a drop-in replacement for the upstream server: same routes, same response shapes, same error format (including the same error JSON format with `h3/nitro` for best compatibility), so the official [`fast-npm-meta`](https://www.npmjs.com/package/fast-npm-meta) npm client works unchanged — just point its `apiEndpoint` at your deployment.

## API

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

## How it differs from upstream

The upstream server is a Nitro app (h3, `unstorage`, `ofetch`, `npm-package-arg`, `semver`/`verkit`) targeting Netlify Edge. This implementation keeps the observable behavior while replacing the stack with Workers-friendly, dependency-light equivalents:

- An extremely fast and tiny router and middleware engine [lemmih](https://github.com/insel-null/lemmih) and an extremely tiny CORS implementation [cors-edge](https://github.com/SukkaW/cors-edge) replacing the Nitro/h3.
- An in-repo, pure re-implementation of the `npm-package-arg` registry subset ([`src/package-arg.ts`](src/package-arg.ts)) with npa's exact error messages — dropping `npm-package-arg` and removes its `node:os` / `node:path` / `hosted-git-info` baggage that cannot run on Cloudflare Workers.
- Caching relies on an in-memory LRU (Cloudflare Workers may persist across invocations if the instance is kept warm) plus the Cloudflare edge CDN cache via `cf` fetch options, with in-flight request deduplication and a single retry on transient registry failures (matching `ofetch`).

## Development

```bash
pnpm dev            # wrangler dev against src/
pnpm build          # rollup -> dist/snippet.js (single-file ESM worker)
pnpm build:analyze  # build + bundle size breakdown (stats.html)
pnpm deploy         # build + wrangler deploy
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

**faster-npm-meta-server** © [Sukka](https://github.com/SukkaW).
Authored and maintained by Sukka with help from contributors ([list](https://github.com/SukkaW/faster-npm-meta-server/graphs/contributors)).

> [Personal Website](https://skk.moe) · [Blog](https://blog.skk.moe) · GitHub [@SukkaW](https://github.com/SukkaW) · Telegram Channel [@SukkaChannel](https://t.me/SukkaChannel) · Mastodon [@sukka@acg.mn](https://acg.mn/@sukka) · Twitter [@isukkaw](https://twitter.com/isukkaw) · BlueSky [@skk.moe](https://bsky.app/profile/skk.moe)

<p align="center">
  <a href="https://github.com/sponsors/SukkaW/">
    <img src="https://sponsor.cdn.skk.moe/sponsors.svg"/>
  </a>
</p>
