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
src/apidoc.ts              ApiDoc, ApiEndpoint, ApiParam, EndpointLink, ApiFlow, endpointRef
src/entities.ts            DB rows on the wire, request bodies, query params
src/constants.ts           header names, proxy path, TOOL_NAME_RE
src/paths.ts               extractPathParams, fillPathTemplate, mcpProxyUrl, resolveUpstreamUrl
src/credential.ts          extractCredential, cookieValue, matchesPathTemplate, raidr.app ⇄ extension bridge
src/security.ts            CrawlRecord, SecurityIssue*, CrawlRecordRequest, list query params
src/schemas/index.ts       zod schemas, exported as ./schemas (zod is an optional peer)
src/index.test.ts          response helpers and path functions
src/schemas/index.test.ts  schema accept/reject cases
src/apidoc.test.ts         endpointRef / parseEndpointRef and the api doc schemas
src/credential.test.ts     extractCredential, matchesPathTemplate, the bridge guards
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
| Rows | `Site` | `sites` row: origin and the `api_hosts` it calls (never its routes) |
| Rows | `SiteRoute` | a page URL the site's UI handles: `url` template (`https://suno.com/song/{id}`, fill with `fillPathTemplate`), `params` (one per `{name}`, in order, with `description`), `query` names, `description`, `urlFields` (`{ apiHost, endpoint, field }` responses that carry the full URL), `sources` (`router`/`code`/`response`/`visited`/`link`, strongest first) |
| Rows | `ApiDocRow` | `api_docs` row: `doc` plus copied title/description/version/source and `endpoint_count` |
| Rows | `ApiDocSummary` | `ApiDocRow` without `doc` (list and public summary) |
| Bodies | `McpUpsertRequest` | `{ manifest }` for POST `/mcps` and PUT `/mcps/:apiHost` |
| Bodies | `SkillUpsertRequest` / `SkillCreateRequest` | PUT `/skills/:apiHost` / POST `/skills` (adds `api_host`) |
| Bodies | `SiteUpsertRequest` / `SiteCreateRequest` | PUT `/sites/:origin` / POST `/sites` (adds `origin`); optional `routes` (≤ `MAX_SITE_ROUTES` = 500) replaces the stored ones |
| Bodies | `ApiDocUpsertRequest` | `{ doc }` for PUT `/apis/:apiHost` |
| Bodies | `ApiExecuteRequest` / `ApiExecuteResult` | POST `/apis/:apiHost/execute`: endpoint id, params, credentials (never stored) / upstream status, headers, body |
| Query | `ListQueryParams` | `q`, `limit` (default 50, max 200), `offset` |
| Query | `SiteListQueryParams` | adds the `apiHost` filter |
| Health | `HealthCheckData` | `{ name, version, status: 'healthy' }` |

Values: `successResponse`, `errorResponse`, `paginatedResponse`,
`extractPathParams`, `fillPathTemplate`, `mcpProxyUrl`, `resolveUpstreamUrl`,
`RAIDR_TOKEN_HEADER` (`X-Raidr-Token`), `RAIDR_API_KEY_HEADER` (`X-API-Key`),
`MCP_PROXY_PATH` (`/mcp`), `TOOL_NAME_RE`, `MCP_SCHEMA_VERSION` (`1`),
`RAIDR_ENTITY_KEY_PREFIX` (`raidr`: entity API keys look like `raidr_<hex>`),
`RAIDR_SETTINGS_FILE` (`~/.raidr/config.json`, where skills keep the key).
Type `RaidrSettings` = `{ apiKey?, apiUrl?, siteTokens? }`, the shape of that
file; `siteTokens` maps an API host to `{ token, savedAt }` and is written by
raidr_cli's `raidr token <apiHost>`.

Site credentials (`src/credential.ts`): `extractCredential(headers, auth)`
returns the token a request carries, in the form raidr sends back as
`X-Raidr-Token`: a `bearer` Authorization value minus its prefix (default
`Bearer `), a `header` value minus `tokenPrefix`, or one `cookie`'s value
(`cookieName`, default `session`). Header names match case-insensitively and
an array value is joined. It returns null for empty values, `null`,
`undefined`, `anonymous`, `guest` and redaction placeholders (`<KIND:…>`).
`cookieValue(cookieHeader, name)` reads one cookie; `matchesPathTemplate`
matches a path (query ignored, trailing `/` ignored) against a template where
`{param}` is one non-empty segment. `CredentialAuth` is the subset of
`ApiUserAuth`/`McpAuth` it needs; `CapturedCredential` is `{ token, verified }`
(`verified`: a request carrying it to a signed-in-only path answered 2xx).

raidr.app ⇄ extension bridge (same file): window messages tagged
`source: RAIDR_BRIDGE_APP` (`raidr-app`) or `RAIDR_BRIDGE_EXTENSION`
(`raidr-extension`). `BridgeRequest` is `ping`, `token/request` (carrying a
`TokenRequest { apiHost, loginUrl, auth, userPaths }`) or `token/cancel`;
`BridgeResponse` is `pong` (with the extension `version`), `token/opened`,
`token/result` (a `CapturedCredential`) or `token/failed` (`reason`
`closed|blocked|error`, optional `message`). Every message has an `id` the
reply echoes. Guards: `isBridgeRequest`, `isBridgeResponse`.

Crawl queue: `CrawlJob` (row of `crawl_jobs`), `CrawlJobStatus`
(`queued|running|done|failed`), `CrawlJobResult` (incl. `crawled_at` and the
published `api_hosts`), `CrawlJobEnqueueRequest`/`Result`
(`queued|already-queued|already-crawled`), `CrawlJobClaimRequest`,
`CrawlJobHeartbeatRequest`, `CrawlJobCompleteRequest`,
`CrawlJobUpdateRequest` (`PUT /crawl-jobs/:id`: mode or priority),
`CrawlJobListQueryParams`, `CrawlJobMode` (`full|api|routes|audit`, on every job),
`CrawlJob.headed_chrome` (crawl in headed Chrome; enqueue/update take it too),
`CrawlJob.audit` (run the security audit; enqueue/update take it too, mode
`audit` implies it); constants `CRAWL_JOB_MAX_ATTEMPTS` (3),
`CRAWL_JOB_LEASE_SECONDS` (1800); zod `crawlJob*Schema` in `./schemas`.

Crawl records and security issues (`src/security.ts`): `CrawlRecord` (row of
`crawls`: one finished crawl, unique on origin + `crawled_at`; `audited`,
`audit_error`, `issue_counts` by severity), `SecurityIssueInput` (`rule`,
`category` secrets/client-code/headers-cookies/api-exposure, `severity`
critical…info, `confidence`, title, description, recommendation, `cwe`
`CWE-n`, `owasp` `Ann:20nn`, `api_host`, masked `evidence[]`,
`fingerprint` stable across crawls), `SecurityIssue` (row), `LatestSecurityIssue`
(+ `crawled_at`, `latest_crawled_at`), `CrawlRecordRequest` (`POST /crawls`,
optional `audit: { issues, error? }`), `CrawlListQueryParams`,
`SecurityIssueListQueryParams` (comma-separated `severity`/`category`);
constants `SECURITY_CATEGORIES`, `SECURITY_SEVERITIES`, `MAX_SECURITY_ISSUES`
(500), `MAX_EVIDENCE_SNIPPET` (500). Zod: `crawlRecordSchema` (fingerprints
unique), `securityIssueInputSchema`, `crawlListQuerySchema`,
`securityIssueListQuerySchema`. raidr_processor's `AuditIssue` has the same
fields; keep the two in step.

API docs (`src/apidoc.ts`): `ApiDoc` (one per API host: `baseUrl`,
`siteOrigins`, `auth`, `endpoints`, optional `links`), `ApiEndpoint` (`id` is
`METHOD path`; `auth`; `params`; `responses`; optional `role: 'login'`),
`ApiParam` (`in` path/query/header/body; `type` incl. `enum`, with
`enumExhaustive`, `itemType`, `format` uuid/email/uri/date/date-time,
`pattern`, min/max length and value, `example`, `wireName` when the wire name
differs), `EndpointAuth` (`none|user|api_key`), `ApiUserAuth` (bearer, header
or cookie, plus `loginUrl`/`tokenHint`), `ApiKeyAuth` (header or query),
`EndpointLink` (`kind` `auth|data`, `evidence` `observed|inferred`,
`fromField`, `toParam`, `count`), `EndpointNodeRef`, `ApiFlow` and
`ExternalEndpointLabel`. Values `endpointRef(baseUrl, endpoint)` →
`METHOD https://host/path` and `parseEndpointRef` (null when invalid).

Schemas (`./schemas`): `apiHostSchema`, `originSchema`,
`jsonSchemaObjectSchema`, `mcpAuthSchema`, `httpMethodSchema`,
`mcpToolRequestSchema`, `mcpToolSchema`, `mcpSourceSchema`,
`mcpManifestSchema`, `mcpUpsertSchema`, `skillUpsertSchema`,
`skillCreateSchema`, `siteRouteSchema` (absolute http(s) URL, no query or
hash, `params` = the URL's placeholders in order, ≥1 distinct source),
`siteRoutesSchema` (unique URLs), `siteUpsertSchema`, `siteCreateSchema`,
`listQuerySchema`, `siteListQuerySchema`, `apiParamSchema`,
`apiEndpointSchema`, `endpointLinkSchema`, `apiDocSchema`,
`apiDocUpsertSchema`, `apiExecuteSchema`.

`apiDocSchema` refinements: `baseUrl` host equals `apiHost` and has no query,
hash or credentials; endpoint ids are unique and equal `METHOD path`; every
`{param}` has a `path` param (identifier, always required); an `enum` param
lists values; GET has no body; endpoint paths follow the `pathTemplate` rules
below; every link ends at one of this doc's endpoints (a same-host `from` must
too, and no endpoint feeds itself; at most 5000 links); `user` / `api_key`
endpoints need `auth.user` / `auth.apiKey`. `apiExecuteSchema` caps
`userToken` at 16384 and `apiKey` at 4096 characters.

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
| `raidr_extension`, `raidr_cli` | root only (`extractCredential`, the bridge protocol, `RaidrSettings`) |

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

All run with Bun on this repo; all pass (35 tests in 4 files).

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
- `ApiEndpoint.id` is `METHOD path` relative to the doc; an `endpointRef` is
  `METHOD https://host/path` and is what raidr_app puts in `?endpoint=`. Do
  not mix the two.
- `extractCredential` is shared by raidr_extension and raidr_cli's
  `raidr token` so both read the same token off the site's traffic. A change
  to what it accepts changes both, and what raidr_api forwards upstream.
- `ApiDoc.links` holds only links that end on this host. raidr_api stores
  them in a separate table so a flow can be read from either end.
