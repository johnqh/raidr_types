# raidr_types

Shared TypeScript types for the raidr platform: MCP manifests, skills, sites,
and the request/response shapes of `raidr_api`.

```bash
npm install @sudobility/raidr_types
```

## Exports

| Import | Contents | Needs |
| --- | --- | --- |
| `@sudobility/raidr_types` | plain types, `successResponse`, `errorResponse`, `paginatedResponse`, path helpers, constants | `@sudobility/types` |
| `@sudobility/raidr_types/schemas` | zod schemas for every wire type, bound to the interfaces with `satisfies` | `zod` v4 |

Only `raidr_api` and `raidr_crawler` import `./schemas`. Front-end packages use
the root export and never pull zod.

## Manifest shape

One `McpManifest` per API host. Each `McpTool` carries a JSON Schema input and
an `McpToolRequest` that maps input fields onto path, query, header and body.
The hosted MCP server in `raidr_api` proxies tool calls from that mapping and
forwards the caller's `X-Raidr-Token` per `McpAuth`.

## Related projects

- `raidr_api` — CRUD for manifests, skills and sites plus the hosted MCP server
- `raidr_crawler` — crawls a site, analyses the bundle, publishes manifests
- `raidr_client` / `raidr_lib` / `raidr_app` — front-end stack
