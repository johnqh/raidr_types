# CLAUDE.md — raidr_types

Shared type contract for the raidr family: `raidr_api`, `raidr_crawler`,
`raidr_client`, `raidr_lib`, `raidr_app`. Published to npm as
`@sudobility/raidr_types` with public access. Bun only.

## Layout

```
src/index.ts          root export: re-exports + response helpers (no zod)
src/mcp.ts            McpManifest, McpTool, McpAuth, McpToolRequest
src/entities.ts       DB rows on the wire, request bodies, query params
src/constants.ts      header names, proxy path, TOOL_NAME_RE
src/paths.ts          extractPathParams, fillPathTemplate, mcpProxyUrl
src/schemas/index.ts  zod schemas, exported as ./schemas (zod is an optional peer)
```

## Rules

- The root export must never import zod. Front-end packages depend on the
  root only.
- Every schema in `src/schemas` ends with `satisfies z.ZodType<Interface>`.
  If you change an interface, the build tells you which schema to update.
- Entity rows use snake_case (`api_host`, `created_at`) like the database.
  Manifest fields use camelCase because they are a document, not a row.
- Bump the version on every change; consumers pin `^0.1.x`.

## Commands

```bash
bun run verify     # typecheck, lint, test, build
```
