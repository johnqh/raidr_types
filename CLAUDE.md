# CLAUDE.md — raidr_types

> **Git policy — never auto-commit or auto-push.** Leave your work in the working tree.
> Run `git commit`, `git push`, `gh pr create`, or `push_all.sh` **only when the user
> explicitly asks in that turn**. Approval for an earlier change does not carry forward, and
> finishing a task is not permission to commit it.

Shared type contract for the raidr family: `raidr_api`, `raidr_crawler`,
`raidr_client`, `raidr_lib`, `raidr_app`. Published to npm as
`@sudobility/raidr_types` with public access. Bun only.

## Purpose

One package owns every shape that crosses a process boundary in raidr: the
MCP manifest the crawler produces and the API serves, the database rows the
API returns, the request bodies it accepts, and the zod rules that validate
them. raidr_crawler's `publish --dry-run` and raidr_api's write routes import
the same schemas, so a manifest that passes locally passes on the server.

## Layout

```
src/index.ts               root export: re-exports + response helpers (no zod)
src/mcp.ts                 McpManifest, McpTool, McpAuth, McpToolRequest
src/entities.ts            DB rows on the wire, request bodies, query params
src/constants.ts           header names, proxy path, TOOL_NAME_RE
src/paths.ts               extractPathParams, fillPathTemplate, mcpProxyUrl, resolveUpstreamUrl
src/schemas/index.ts       zod schemas, exported as ./schemas (zod is an optional peer)
src/index.test.ts          response helpers and path functions
src/schemas/index.test.ts  schema accept/reject cases
```

## The two exports

| Import | Contents | Needs |
| --- | --- | --- |
| `@sudobility/raidr_types` | plain types, response helpers, path helpers, constants | `@sudobility/types` (peer) |
| `@sudobility/raidr_types/schemas` | zod schemas bound to the interfaces with `satisfies` | `zod` v4 (optional peer) |

- The root never imports zod. `zod` is optional in `peerDependenciesMeta`, so
  a front end that imports only the root never has to install it. Check:
  `grep -n "from 'zod'" src/*.ts` prints nothing.
- `./schemas` imports its types plus `TOOL_NAME_RE` and `extractPathParams`
  from `../index.js`, so the rules and the helpers cannot diverge.
- `tsconfig.json` excludes `*.test.ts`, so tests never reach `dist`.

## Exported types by area

| Area | Export | One line |
| --- | --- | --- |
| Re-exported | `ApiResponse`, `BaseResponse`, `Optional`, `PaginatedResponse`, `PaginationInfo`, `PaginationOptions` | from `@sudobility/types` |
| Manifest | `JsonSchema` | any JSON Schema value (`Record<string, unknown>`) |
| Manifest | `JsonSchemaObject` | JSON Schema with `type: 'object'` at the root; MCP tool inputs |
| Manifest | `McpAuthStyle` | `bearer` / `header` / `cookie` / `none` |
| Manifest | `McpAuth` | style plus `headerName`, `cookieName`, `tokenPrefix` |
| Manifest | `HttpMethod` | `GET` / `POST` / `PUT` / `PATCH` / `DELETE` |
| Manifest | `McpToolRequest` | maps input fields onto path, query, headers, body |
| Manifest | `McpToolResponseHints` | optional content type, description, example |
| Manifest | `McpToolEvidence` | `endpointKey`, call count, chunk file from the capture |
| Manifest | `McpTool` | name, description, `inputSchema`, `request`, hints, evidence |
| Manifest | `McpSource` | bundle name, crawler version, analyzer, capture time |
| Manifest | `McpManifest` | the whole document for one API host |
| Rows | `Mcp` | `mcps` row: manifest plus denormalized title/description/version/source |
| Rows | `McpSummary` | `Mcp` without `manifest`, plus `tool_count` (list rows) |
| Rows | `Skill` | `skills` row: SKILL.md markdown per API host |
| Rows | `SkillSummary` | `Skill` without `markdown` (list rows) |
| Rows | `Site` | `sites` row: origin and the `api_hosts` it calls |
| Bodies | `McpUpsertRequest` | `{ manifest }` for POST `/mcps` and PUT `/mcps/:apiHost` |
| Bodies | `SkillUpsertRequest` / `SkillCreateRequest` | PUT `/skills/:apiHost` / POST `/skills` (adds `api_host`) |
| Bodies | `SiteUpsertRequest` / `SiteCreateRequest` | PUT `/sites/:origin` / POST `/sites` (adds `origin`) |
| Query | `ListQueryParams` | `q`, `limit` (default 50, max 200), `offset` |
| Query | `SiteListQueryParams` | adds the `apiHost` filter |
| Health | `HealthCheckData` | `{ name, version, status: 'healthy' }` |

Values: `successResponse`, `errorResponse`, `paginatedResponse`,
`extractPathParams`, `fillPathTemplate`, `mcpProxyUrl`, `resolveUpstreamUrl`,
`RAIDR_TOKEN_HEADER` (`X-Raidr-Token`), `RAIDR_API_KEY_HEADER` (`X-API-Key`),
`MCP_PROXY_PATH` (`/mcp`), `TOOL_NAME_RE`, `MCP_SCHEMA_VERSION` (`1`),
`RAIDR_ENTITY_KEY_PREFIX` (`raidr`: entity API keys look like `raidr_<hex>`),
`RAIDR_SETTINGS_FILE` (`~/.raidr/config.json`, where skills keep the key).
Type `RaidrSettings` = `{ apiKey?, apiUrl? }`, the shape of that file.

Crawl queue: `CrawlJob` (row of `crawl_jobs`), `CrawlJobStatus`
(`queued|running|done|failed`), `CrawlJobResult` (incl. `crawled_at` and the
published `api_hosts`), `CrawlJobEnqueueRequest`/`Result`
(`queued|already-queued|already-crawled`), `CrawlJobClaimRequest`,
`CrawlJobHeartbeatRequest`, `CrawlJobCompleteRequest`,
`CrawlJobListQueryParams`; constants `CRAWL_JOB_MAX_ATTEMPTS` (3),
`CRAWL_JOB_LEASE_SECONDS` (1800); zod `crawlJob*Schema` in `./schemas`.

Schemas (`./schemas`): `apiHostSchema`, `originSchema`,
`jsonSchemaObjectSchema`, `mcpAuthSchema`, `httpMethodSchema`,
`mcpToolRequestSchema`, `mcpToolSchema`, `mcpSourceSchema`,
`mcpManifestSchema`, `mcpUpsertSchema`, `skillUpsertSchema`,
`skillCreateSchema`, `siteUpsertSchema`, `siteCreateSchema`,
`listQuerySchema`, `siteListQuerySchema`.

## Manifest semantics

One `McpManifest` per API host. raidr_api turns each `McpTool` into an MCP
tool and proxies calls using its `request` mapping.

### Auth styles (applied by raidr_api `src/mcp/upstream.ts` → `applyAuth`)

| Style | Header set | Schema requires |
| --- | --- | --- |
| `bearer` | `Authorization: <tokenPrefix ?? "Bearer "><token>` | — |
| `header` | `<headerName>: <tokenPrefix ?? ""><token>` | `headerName` |
| `cookie` | `Cookie: <cookieName>=<token>` (prefix ignored) | `cookieName` |
| `none` | nothing | — |

The token is the caller's `X-Raidr-Token` for that one MCP request. With no
token, no auth header is set. Auth is applied last, so it overwrites a
`staticHeaders` entry or mapped header of the same name.

### Request mapping (`McpToolRequest`)

| Field | Effect in raidr_api `buildUpstreamRequest` |
| --- | --- |
| `pathTemplate` | `{param}` filled with `encodeURIComponent`; a missing (undefined/null) value is a tool input error |
| `query` | input field → query name; arrays append one param per item; null/undefined skipped; non-strings JSON-encoded |
| `headers` | input field → header name; null/undefined skipped |
| `body` | `json` or `form` for non-GET; a GET with a body is a schema error |
| `bodyFields` | fields sent in the body; default is every input not used by path/query/headers |

`staticHeaders` are set on every call before mapped headers. Every name used
in path, query, headers and `bodyFields` must be a key of
`inputSchema.properties` (`mcpToolSchema` `superRefine`).

### Safety rules and why

The manifest decides where a user's token is sent, so every rule keeps
requests on `apiHost`:

- `baseUrl` must be http(s) with no username, password, query or hash, and
  its host must equal `apiHost` (`mcpManifestSchema`).
- `pathTemplate` must start with `/` and must not start with `//`, contain
  `://` or contain `\` (`mcpToolRequestSchema`). `//evil.com/x` and
  `https://evil.com/x` would otherwise resolve to another host.
- `resolveUpstreamUrl` concatenates `baseUrl` + path (keeping a base path such
  as `/v1`) and throws unless the result's host is `apiHost` and its origin is
  `baseUrl`'s origin. raidr_api calls it on every tool call, independent of
  write-time validation.
- Tool names match `TOOL_NAME_RE` and are unique within a manifest.

## Naming: snake_case rows, camelCase manifest

- Entity rows use snake_case (`api_host`, `created_at`) like the database.
- Manifest fields use camelCase because they are a document stored whole in a
  JSONB column, not a row.
- Request bodies follow the row they write (`api_host`, `last_crawled_at`).
  The `apiHost` query param is camelCase.
- Row timestamps are typed `Date | null`; over HTTP they arrive as ISO 8601
  strings after JSON serialization.

## Consumers

| Repo | Imports |
| --- | --- |
| `raidr_api` | root + `./schemas` (validates every write) |
| `raidr_crawler` | root + `./schemas` (`publish --dry-run`) |
| `raidr_client`, `raidr_lib`, `raidr_app` | root only; never zod |

## Rules

- The root export must never import zod. Front-end packages depend on the
  root only.
- Every schema in `src/schemas` ends with `satisfies z.ZodType<Interface>`.
  If you change an interface, the build tells you which schema to update.
  (Currently unbound: `apiHostSchema`, `originSchema`, `httpMethodSchema`,
  and the two query schemas, whose output adds defaults.)
- Entity rows use snake_case (`api_host`, `created_at`) like the database.
  Manifest fields use camelCase because they are a document, not a row.
- Bump the version on every change; consumers pin `^0.1.x`.

## Changing a type safely

1. Edit the interface in `src/mcp.ts` or `src/entities.ts`.
2. Update the schema in `src/schemas/index.ts`; `bun run typecheck` fails on
   its `satisfies` line until the two agree.
3. Add accept and reject cases to `src/schemas/index.test.ts` (and
   `src/index.test.ts` for helpers).
4. `bun run verify`.
5. Bump `version` in `package.json` (a release step: only when the user asks).
6. Publish: CI (`johnqh/workflows` unified CI, `npm-access: public`) publishes
   when `NPM_TOKEN` is configured. Then update `raidr_api` and
   `raidr_crawler` (they validate), then the front ends.

Stored manifests are not re-validated when raidr_api reads them, so a new
required field only binds on the next write. Prefer optional fields, and make
readers tolerate the old shape.

## Commands

All run with Bun on this repo; all pass (19 tests in 2 files).

| Command | Does |
| --- | --- |
| `bun run verify` | typecheck, lint, test:unit, build |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | `eslint src --ext .ts` (prettier runs as a lint rule) |
| `bun run test:unit` | `vitest run` |
| `bun run build` | `tsc -p tsconfig.esm.json` → `dist/` with `.d.ts` and maps |
| `bun run format:check` | prettier check on `src` |
| `bun run clean` | `rimraf dist` |

`prepublishOnly` runs `clean` then `verify`.

## Gotchas

- `McpToolRequest.body` absent means no body, except that raidr_api still
  sends a JSON body when `bodyFields` is non-empty on a non-GET tool.
- `listQuerySchema` output always has `limit` and `offset`, so its inferred
  type differs from `ListQueryParams`.
- `mcpProxyUrl` URL-encodes the host: `localhost:8080` becomes
  `localhost%3A8080` in the path.
- Prettier here uses single quotes; raidr_api uses double quotes.
