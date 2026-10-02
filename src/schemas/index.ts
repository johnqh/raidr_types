/**
 * Zod schemas for the raidr wire types. Imported as
 * `@sudobility/raidr_types/schemas`; needs `zod` v4 installed by the caller.
 *
 * Each schema is bound to its interface with `satisfies`, so the package
 * fails to build when the two drift apart.
 */

import { z } from 'zod';
import type {
  EndpointLink,
  ApiDoc,
  ApiDocUpsertRequest,
  ApiEndpoint,
  ApiExecuteRequest,
  ApiParam,
  CrawlJobClaimRequest,
  CrawlJobCompleteRequest,
  CrawlJobEnqueueRequest,
  CrawlJobHeartbeatRequest,
  CrawlJobResult,
  JsonSchemaObject,
  McpAuth,
  McpManifest,
  McpSource,
  McpTool,
  McpToolRequest,
  McpUpsertRequest,
  SiteCreateRequest,
  SiteUpsertRequest,
  SkillCreateRequest,
  SkillUpsertRequest,
} from '../index.js';
import {
  LABEL_RE,
  MAX_LABELS,
  TOOL_NAME_RE,
  extractPathParams,
} from '../index.js';

/** Bare host name with an optional port; no scheme, path or credentials. */
const HOST_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

/** An API host such as `api.example.com` or `localhost:8080`, at most 253 chars. */
/** Up to `MAX_LABELS` distinct lowercase slugs. */
export const labelsSchema = z
  .array(z.string().regex(LABEL_RE, 'must be a lowercase slug'))
  .max(MAX_LABELS)
  .refine((labels) => new Set(labels).size === labels.length, {
    message: 'labels must be unique',
  });

export const apiHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(HOST_RE, 'must be a bare host name such as api.example.com');

/**
 * A bare origin (`https://www.example.com`): the value must equal its own
 * `new URL(value).origin`, so trailing slashes, paths and queries are rejected.
 * Keeps one canonical key per site in the `sites` table.
 */
export const originSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        return new URL(value).origin === value;
      } catch {
        return false;
      }
    },
    { message: 'must be an origin such as https://www.example.com' }
  );

/**
 * Minimal structural check of a tool input schema. `.loose()` keeps every
 * other JSON Schema keyword, because the schema is served to MCP clients
 * verbatim.
 */
export const jsonSchemaObjectSchema = z
  .object({
    type: z.literal('object'),
    properties: z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z
      .union([z.boolean(), z.record(z.string(), z.unknown())])
      .optional(),
    description: z.string().optional(),
  })
  .loose() satisfies z.ZodType<JsonSchemaObject>;

/** `McpAuth`, plus the per-style required field checks. */
export const mcpAuthSchema = z
  .object({
    style: z.enum(['bearer', 'header', 'cookie', 'none']),
    headerName: z.string().min(1).optional(),
    cookieName: z.string().min(1).optional(),
    tokenPrefix: z.string().optional(),
  })
  .refine((auth) => auth.style !== 'header' || !!auth.headerName, {
    message: 'headerName is required when style is "header"',
    path: ['headerName'],
  })
  .refine((auth) => auth.style !== 'cookie' || !!auth.cookieName, {
    message: 'cookieName is required when style is "cookie"',
    path: ['cookieName'],
  }) satisfies z.ZodType<McpAuth>;

/** `HttpMethod`. */
export const httpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/** `McpToolRequest`: pathTemplate must stay on the host; GET has no body. */
export const mcpToolRequestSchema = z
  .object({
    method: httpMethodSchema,
    // A path, never a URL: '//host/x' and 'https://host/x' would send the
    // caller's token to a host other than the manifest's apiHost.
    pathTemplate: z
      .string()
      .startsWith('/')
      .refine((path) => !path.startsWith('//') && !path.includes('://'), {
        message: 'must be a path on the API host, not a URL',
      })
      .refine((path) => !path.includes('\\'), {
        message: 'must not contain backslashes',
      }),
    query: z.record(z.string(), z.string()).optional(),
    body: z.enum(['json', 'form']).nullable().optional(),
    bodyFields: z.array(z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .refine((request) => request.method !== 'GET' || !request.body, {
    message: 'GET requests cannot carry a body',
    path: ['body'],
  }) satisfies z.ZodType<McpToolRequest>;

/**
 * `McpTool`. Cross-checks the request mapping against `inputSchema`: every
 * path placeholder, query key, header key and body field must be a declared
 * input property, so a tool can never reference a field the client cannot
 * send.
 */
export const mcpToolSchema = z
  .object({
    name: z
      .string()
      .regex(TOOL_NAME_RE, 'snake_case, 2-64 chars, letter first'),
    description: z.string().min(1),
    inputSchema: jsonSchemaObjectSchema,
    request: mcpToolRequestSchema,
    responseHints: z
      .object({
        contentType: z.string().optional(),
        description: z.string().optional(),
        example: z.unknown().optional(),
      })
      .optional(),
    evidence: z
      .object({
        endpointKey: z.string(),
        calls: z.number().int().nonnegative(),
        chunk: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((tool, ctx) => {
    const fields = new Set(Object.keys(tool.inputSchema.properties ?? {}));
    for (const param of extractPathParams(tool.request.pathTemplate)) {
      if (!fields.has(param)) {
        ctx.addIssue({
          code: 'custom',
          path: ['request', 'pathTemplate'],
          message: `path parameter "${param}" is not in inputSchema.properties`,
        });
      }
    }
    const check = (names: string[], where: string) => {
      for (const name of names) {
        if (!fields.has(name)) {
          ctx.addIssue({
            code: 'custom',
            path: ['request', where],
            message: `"${name}" is not in inputSchema.properties`,
          });
        }
      }
    };
    check(Object.keys(tool.request.query ?? {}), 'query');
    check(Object.keys(tool.request.headers ?? {}), 'headers');
    check(tool.request.bodyFields ?? [], 'bodyFields');
  }) satisfies z.ZodType<McpTool>;

/** `McpSource`. */
export const mcpSourceSchema = z.object({
  bundleName: z.string().min(1),
  crawlerVersion: z.string().min(1),
  analyzedBy: z.string().optional(),
  capturedAt: z.string().optional(),
}) satisfies z.ZodType<McpSource>;

/**
 * `McpManifest`, the rule set shared by raidr_api (on write) and
 * raidr_crawler (`publish --dry-run`). Beyond field shapes it requires that
 * `baseUrl`'s host equals `apiHost` and that tool names are unique.
 */
export const mcpManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    apiHost: apiHostSchema,
    baseUrl: z
      .string()
      .url()
      .refine(
        (value) => {
          try {
            const url = new URL(value);
            return (
              (url.protocol === 'https:' || url.protocol === 'http:') &&
              url.username === '' &&
              url.password === '' &&
              url.search === '' &&
              url.hash === ''
            );
          } catch {
            return false;
          }
        },
        { message: 'must be an http(s) URL without credentials, query or hash' }
      ),
    siteOrigins: z.array(originSchema),
    title: z.string().min(1),
    description: z.string(),
    auth: mcpAuthSchema,
    staticHeaders: z.record(z.string(), z.string()).optional(),
    tools: z.array(mcpToolSchema),
    labels: labelsSchema.optional(),
    version: z.string().min(1),
    generatedAt: z.string().min(1),
    source: mcpSourceSchema,
  })
  .superRefine((manifest, ctx) => {
    let host: string | null = null;
    try {
      host = new URL(manifest.baseUrl).host;
    } catch {
      host = null;
    }
    if (host !== manifest.apiHost) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: `baseUrl host must equal apiHost "${manifest.apiHost}"`,
      });
    }
    const names = new Set<string>();
    manifest.tools.forEach((tool, index) => {
      if (names.has(tool.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['tools', index, 'name'],
          message: `duplicate tool name "${tool.name}"`,
        });
      }
      names.add(tool.name);
    });
  }) satisfies z.ZodType<McpManifest>;

/** Body of `POST /mcps` and `PUT /mcps/:apiHost`. */
export const mcpUpsertSchema = z.object({
  manifest: mcpManifestSchema,
}) satisfies z.ZodType<McpUpsertRequest>;

/** Body of `PUT /skills/:apiHost`. */
export const skillUpsertSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  markdown: z.string().min(1),
  version: z.string().optional(),
}) satisfies z.ZodType<SkillUpsertRequest>;

/** Body of `POST /skills`: the upsert body plus `api_host`. */
export const skillCreateSchema = skillUpsertSchema.extend({
  api_host: apiHostSchema,
}) satisfies z.ZodType<SkillCreateRequest>;

/** Body of `PUT /sites/:origin`. `last_crawled_at` is an ISO 8601 string. */
export const siteUpsertSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  api_hosts: z.array(apiHostSchema),
  labels: labelsSchema.optional(),
  last_crawled_at: z.string().optional(),
}) satisfies z.ZodType<SiteUpsertRequest>;

/** Body of `POST /sites`: the upsert body plus `origin`. */
export const siteCreateSchema = siteUpsertSchema.extend({
  origin: originSchema,
}) satisfies z.ZodType<SiteCreateRequest>;

/**
 * `?q&limit&offset` for list routes. Coerces query-string numbers and fills
 * defaults (limit 50, max 200; offset 0). Not bound with `satisfies`: its
 * output has required `limit`/`offset`, unlike `ListQueryParams`.
 */
export const listQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Comma-separated labels in a query string, as a slug list. */
const labelQuerySchema = z
  .string()
  .max(500)
  .transform((value) =>
    value
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => LABEL_RE.test(l))
  );

/** `listQuerySchema` plus the optional `label` filter for `GET /mcps`. */
export const mcpListQuerySchema = listQuerySchema.extend({
  label: labelQuerySchema.optional(),
});

/** `listQuerySchema` plus the optional `apiHost` and `label` filters for `GET /sites`. */
export const siteListQuerySchema = listQuerySchema.extend({
  apiHost: apiHostSchema.optional(),
  label: labelQuerySchema.optional(),
});

// =============================================================================
// Crawl jobs
// =============================================================================

export const crawlJobStatusSchema = z.enum([
  'queued',
  'running',
  'done',
  'failed',
]);

/** `CrawlJobResult`. */
export const crawlJobResultSchema = z.object({
  crawled_at: z.string().datetime({ offset: true }).nullable(),
  rendering: z.string().nullable(),
  pages: z.number().int().nullable(),
  scripts: z.number().int().nullable(),
  api_hosts: z.array(apiHostSchema),
  tools: z.number().int().min(0),
  skipped_hosts: z.number().int().min(0),
  seconds: z.number().min(0),
}) satisfies z.ZodType<CrawlJobResult>;

/** Body of `POST /crawl-jobs`: 1 to 500 origins. */
export const crawlJobEnqueueSchema = z.object({
  origins: z.array(originSchema).min(1).max(500),
  force: z.boolean().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  requested_by: z.string().max(200).optional(),
  labels: labelsSchema.optional(),
}) satisfies z.ZodType<CrawlJobEnqueueRequest>;

const workerSchema = z.string().min(1).max(200);
const leaseSchema = z
  .number()
  .int()
  .min(30)
  .max(24 * 3600)
  .optional();

export const crawlJobClaimSchema = z.object({
  worker: workerSchema,
  lease_seconds: leaseSchema,
}) satisfies z.ZodType<CrawlJobClaimRequest>;

export const crawlJobHeartbeatSchema = z.object({
  worker: workerSchema,
  lease_seconds: leaseSchema,
}) satisfies z.ZodType<CrawlJobHeartbeatRequest>;

export const crawlJobCompleteSchema = z.object({
  worker: workerSchema,
  status: z.enum(['done', 'failed']),
  result: crawlJobResultSchema.optional(),
  error: z.string().max(4000).optional(),
}) satisfies z.ZodType<CrawlJobCompleteRequest>;

/** `GET /crawl-jobs` query. */
export const crawlJobListQuerySchema = listQuerySchema.extend({
  status: crawlJobStatusSchema.optional(),
});

// =============================================================================
// API documentation
// =============================================================================

/** A path on the API host, never a URL (same rule as `mcpToolRequestSchema`). */
const apiPathSchema = z
  .string()
  .startsWith('/')
  .refine((path) => !path.startsWith('//') && !path.includes('://'), {
    message: 'must be a path on the API host, not a URL',
  })
  .refine((path) => !path.includes('\\'), {
    message: 'must not contain backslashes',
  });

/** `ApiParam`. Path and query names must be safe identifiers for the URL builder. */
export const apiParamSchema = z
  .object({
    name: z.string().min(1).max(200),
    in: z.enum(['path', 'query', 'header', 'body']),
    type: z.enum([
      'string',
      'integer',
      'number',
      'boolean',
      'enum',
      'object',
      'array',
    ]),
    required: z.boolean(),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
    enumExhaustive: z.boolean().optional(),
    itemType: z
      .enum(['string', 'integer', 'number', 'boolean', 'object'])
      .optional(),
    format: z.enum(['uuid', 'email', 'uri', 'date', 'date-time']).optional(),
    pattern: z.string().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    example: z.unknown().optional(),
    wireName: z.string().min(1).optional(),
  })
  .refine((p) => p.type !== 'enum' || (p.enum?.length ?? 0) > 0, {
    message: 'an enum parameter lists its values',
    path: ['enum'],
  })
  .refine((p) => p.in !== 'path' || /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name), {
    message: 'a path parameter name must be an identifier (it fills {name})',
    path: ['name'],
  })
  .refine((p) => p.in !== 'path' || p.required, {
    message: 'path parameters are always required',
    path: ['required'],
  }) satisfies z.ZodType<ApiParam>;

/** `ApiEndpoint`: id is `METHOD path`; every `{param}` has a path parameter. */
export const apiEndpointSchema = z
  .object({
    id: z.string().min(1),
    method: httpMethodSchema,
    path: apiPathSchema,
    summary: z.string().min(1),
    description: z.string().optional(),
    auth: z.enum(['none', 'user', 'api_key']),
    params: z.array(apiParamSchema),
    body: z.enum(['json', 'form']).nullable().optional(),
    additionalBody: z.boolean().optional(),
    responses: z.array(
      z.object({
        status: z.number().int().min(100).max(599),
        description: z.string().optional(),
        contentType: z.string().optional(),
        fields: z.array(z.string()).optional(),
        example: z.string().max(8192).optional(),
      })
    ),
    tag: z.string().optional(),
    role: z.literal('login').optional(),
  })
  .superRefine((endpoint, ctx) => {
    if (endpoint.id !== `${endpoint.method} ${endpoint.path}`) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'id must be "METHOD path"',
      });
    }
    if (endpoint.method === 'GET' && endpoint.body) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'GET requests cannot carry a body',
      });
    }
    const names = new Set<string>();
    for (const [i, p] of endpoint.params.entries()) {
      if (names.has(p.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['params', i, 'name'],
          message: `duplicate parameter "${p.name}"`,
        });
      }
      names.add(p.name);
    }
    const pathParams = new Set(
      endpoint.params.filter((p) => p.in === 'path').map((p) => p.name)
    );
    for (const param of extractPathParams(endpoint.path)) {
      if (!pathParams.has(param)) {
        ctx.addIssue({
          code: 'custom',
          path: ['path'],
          message: `path parameter "${param}" is not documented`,
        });
      }
    }
  }) satisfies z.ZodType<ApiEndpoint>;

const endpointNodeRefSchema = z.object({
  apiHost: apiHostSchema,
  endpointId: z.string().min(1),
});

/** `EndpointLink`. */
export const endpointLinkSchema = z.object({
  from: endpointNodeRefSchema,
  to: endpointNodeRefSchema,
  kind: z.enum(['auth', 'data']),
  evidence: z.enum(['observed', 'inferred']),
  fromField: z.string().max(500).optional(),
  toParam: z.string().max(200).optional(),
  count: z.number().int().min(0).optional(),
}) satisfies z.ZodType<EndpointLink>;

/** `ApiDoc`: `baseUrl` host equals `apiHost`; endpoint ids are unique. */
export const apiDocSchema = z
  .object({
    schemaVersion: z.literal(1),
    apiHost: apiHostSchema,
    baseUrl: z.string().url(),
    siteOrigins: z.array(originSchema),
    title: z.string().min(1),
    description: z.string(),
    auth: z.object({
      user: z
        .object({
          style: z.enum(['bearer', 'header', 'cookie']),
          headerName: z.string().optional(),
          cookieName: z.string().optional(),
          tokenPrefix: z.string().optional(),
          loginUrl: z.string().url().optional(),
          tokenHint: z.string().optional(),
        })
        .refine((u) => u.style !== 'header' || !!u.headerName, {
          message: 'header style requires headerName',
        })
        .refine((u) => u.style !== 'cookie' || !!u.cookieName, {
          message: 'cookie style requires cookieName',
        })
        .optional(),
      apiKey: z
        .object({
          in: z.enum(['header', 'query']),
          name: z.string().min(1),
          hint: z.string().optional(),
        })
        .optional(),
    }),
    endpoints: z.array(apiEndpointSchema),
    links: z.array(endpointLinkSchema).max(5000).optional(),
    version: z.string().min(1),
    generatedAt: z.string().min(1),
    source: mcpSourceSchema,
  })
  .superRefine((doc, ctx) => {
    let host: string | null = null;
    try {
      const url = new URL(doc.baseUrl);
      if (url.search || url.hash || url.username || url.password) {
        ctx.addIssue({
          code: 'custom',
          path: ['baseUrl'],
          message: 'baseUrl has no query, hash or credentials',
        });
      }
      host = url.host;
    } catch {
      host = null;
    }
    if (host !== doc.apiHost) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: `baseUrl host must equal apiHost "${doc.apiHost}"`,
      });
    }
    const ids = new Set<string>();
    doc.endpoints.forEach((e, i) => {
      if (ids.has(e.id))
        ctx.addIssue({
          code: 'custom',
          path: ['endpoints', i, 'id'],
          message: `duplicate endpoint "${e.id}"`,
        });
      ids.add(e.id);
    });
    // A doc carries the links into its own endpoints; `from` may be anywhere.
    (doc.links ?? []).forEach((link, i) => {
      if (link.to.apiHost !== doc.apiHost || !ids.has(link.to.endpointId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['links', i, 'to'],
          message: "a link must end at one of this doc's endpoints",
        });
      }
      if (link.from.apiHost === doc.apiHost && !ids.has(link.from.endpointId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['links', i, 'from'],
          message: "a same-host link must start at one of this doc's endpoints",
        });
      }
      if (
        link.from.apiHost === link.to.apiHost &&
        link.from.endpointId === link.to.endpointId
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['links', i],
          message: 'an endpoint cannot feed itself',
        });
      }
    });
    const needsUser = doc.endpoints.some((e) => e.auth === 'user');
    const needsKey = doc.endpoints.some((e) => e.auth === 'api_key');
    if (needsUser && !doc.auth.user) {
      ctx.addIssue({
        code: 'custom',
        path: ['auth', 'user'],
        message: 'user endpoints need auth.user',
      });
    }
    if (needsKey && !doc.auth.apiKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['auth', 'apiKey'],
        message: 'api_key endpoints need auth.apiKey',
      });
    }
  }) satisfies z.ZodType<ApiDoc>;

/** Body of `PUT /apis/:apiHost`. */
export const apiDocUpsertSchema = z.object({
  doc: apiDocSchema,
}) satisfies z.ZodType<ApiDocUpsertRequest>;

/** Body of `POST /apis/:apiHost/execute`. Credentials are bounded, never stored. */
export const apiExecuteSchema = z.object({
  endpointId: z.string().min(1).max(500),
  params: z.record(z.string(), z.unknown()),
  extraBody: z.record(z.string(), z.unknown()).optional(),
  userToken: z.string().max(16384).optional(),
  apiKey: z.string().max(4096).optional(),
}) satisfies z.ZodType<ApiExecuteRequest>;
