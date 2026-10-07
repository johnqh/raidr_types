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
  ApiDocV1,
  ApiDocV2,
  ApiEndpointV2,
  ApiExecuteInput,
  ApiJsonSchema,
  EndpointInputSchema,
  EndpointResponse,
  HeaderRecipe,
  HeaderSource,
  ApiDocUpsertRequest,
  ApiEndpoint,
  ApiExecuteRequest,
  ApiParam,
  CrawlJobClaimRequest,
  CrawlJobCompleteRequest,
  CrawlJobEnqueueRequest,
  CrawlJobHeartbeatRequest,
  CrawlJobResult,
  CrawlJobUpdateRequest,
  CrawlAuditInput,
  CrawlRecordRequest,
  JsonSchemaObject,
  SecurityEvidence,
  SecurityIssueInput,
  McpAuth,
  McpManifest,
  McpSource,
  McpTool,
  McpToolRequest,
  McpUpsertRequest,
  SiteCreateRequest,
  SiteRoute,
  SiteRouteParam,
  SiteRouteUrlField,
  SiteUpsertRequest,
  SkillCreateRequest,
  SkillUpsertRequest,
} from '../index.js';
import {
  LABEL_RE,
  MAX_EVIDENCE_SNIPPET,
  MAX_LABELS,
  MAX_SECURITY_ISSUES,
  MAX_SITE_ROUTES,
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
    bodyArg: z.string().min(1).optional(),
    staticHeaders: z.record(z.string(), z.string().max(4096)).optional(),
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
    check(tool.request.bodyArg ? [tool.request.bodyArg] : [], 'bodyArg');
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

const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A site route. `url` is an absolute http(s) URL template with no query or
 * hash, and `params` names its `{name}` placeholders exactly, in order.
 */
export const siteRouteSchema = z
  .object({
    url: z.string().min(1).max(500),
    params: z
      .array(
        z.object({
          name: z.string().regex(PARAM_NAME_RE),
          description: z.string().max(300).nullable(),
        }) satisfies z.ZodType<SiteRouteParam>
      )
      .max(10),
    query: z.array(z.string().min(1).max(60)).max(20),
    description: z.string().max(300).nullable(),
    urlFields: z
      .array(
        z.object({
          apiHost: apiHostSchema,
          endpoint: z.string().min(1).max(300),
          field: z.string().min(1).max(200),
        }) satisfies z.ZodType<SiteRouteUrlField>
      )
      .max(10),
    sources: z
      .array(z.enum(['router', 'code', 'response', 'visited', 'link']))
      .min(1)
      .refine((s) => new Set(s).size === s.length, {
        message: 'sources must be unique',
      }),
  })
  .superRefine((route, ctx) => {
    let url: URL;
    try {
      // Placeholders are not valid in every URL position; check the shape with them filled.
      url = new URL(route.url.replace(/\{[^}]*\}/g, 'x'));
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'must be an absolute URL template',
      });
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'must be http or https',
      });
    }
    if (url.search || url.hash || /[?#]/.test(route.url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'must not have a query or hash; list query names in `query`',
      });
    }
    if (/\{(?![A-Za-z_][A-Za-z0-9_]*\})/.test(route.url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'placeholders must be {identifier}',
      });
    }
    const placeholders = extractPathParams(route.url);
    const names = route.params.map((p) => p.name);
    if (placeholders.join(',') !== names.join(',')) {
      ctx.addIssue({
        code: 'custom',
        path: ['params'],
        message: `params must name the URL's placeholders in order (${placeholders.join(', ') || 'none'})`,
      });
    }
  }) satisfies z.ZodType<SiteRoute>;

/** Up to `MAX_SITE_ROUTES` routes with distinct URLs. */
export const siteRoutesSchema = z
  .array(siteRouteSchema)
  .max(MAX_SITE_ROUTES)
  .refine(
    (routes) => new Set(routes.map((r) => r.url)).size === routes.length,
    {
      message: 'route urls must be unique',
    }
  );

/** Body of `PUT /sites/:origin`. `last_crawled_at` is an ISO 8601 string. */
export const siteUpsertSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  api_hosts: z.array(apiHostSchema),
  labels: labelsSchema.optional(),
  last_crawled_at: z.string().optional(),
  routes: siteRoutesSchema.optional(),
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
  'pending',
  'crawling',
  'completed',
  'failed',
]);

export const crawlJobModeSchema = z.enum(['full', 'api', 'routes', 'audit']);

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
  mode: crawlJobModeSchema.optional(),
  headed_chrome: z.boolean().optional(),
  audit: z.boolean().optional(),
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

/** Body of `PUT /crawl-jobs/:id`: at least one field. */
export const crawlJobUpdateSchema = z
  .object({
    mode: crawlJobModeSchema.optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
    headed_chrome: z.boolean().optional(),
    audit: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.mode !== undefined ||
      b.priority !== undefined ||
      b.headed_chrome !== undefined ||
      b.audit !== undefined,
    { message: 'Give mode, priority, headed_chrome or audit' }
  ) satisfies z.ZodType<CrawlJobUpdateRequest>;

export const crawlJobCompleteSchema = z.object({
  worker: workerSchema,
  status: z.enum(['completed', 'failed']),
  result: crawlJobResultSchema.optional(),
  error: z.string().max(4000).optional(),
}) satisfies z.ZodType<CrawlJobCompleteRequest>;

/** `GET /crawl-jobs` query. */
export const crawlJobListQuerySchema = listQuerySchema.extend({
  status: crawlJobStatusSchema.optional(),
  mode: crawlJobModeSchema.optional(),
});

// =============================================================================
// Crawl records and security issues
// =============================================================================

export const securityCategorySchema = z.enum([
  'secrets',
  'client-code',
  'headers-cookies',
  'api-exposure',
]);

export const securitySeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'info',
]);

export const securityConfidenceSchema = z.enum(['high', 'medium', 'low']);

/** `SecurityEvidence`. */
export const securityEvidenceSchema = z.object({
  kind: z.enum(['code', 'traffic', 'header', 'cookie']),
  file: z.string().max(1000).optional(),
  line: z.number().int().min(0).optional(),
  snippet: z.string().max(MAX_EVIDENCE_SNIPPET).optional(),
  url: z.string().max(2000).optional(),
  endpoint: z.string().max(1000).optional(),
  header: z.string().max(200).optional(),
  cookie: z.string().max(200).optional(),
}) satisfies z.ZodType<SecurityEvidence>;

/** `SecurityIssueInput`. */
export const securityIssueInputSchema = z.object({
  rule: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a kebab-case rule id'),
  category: securityCategorySchema,
  severity: securitySeveritySchema,
  confidence: securityConfidenceSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  recommendation: z.string().min(1).max(2000),
  cwe: z
    .string()
    .regex(/^CWE-\d{1,5}$/, 'must look like CWE-79')
    .nullable(),
  owasp: z
    .string()
    .regex(/^A\d{2}:20\d{2}$/, 'must look like A03:2021')
    .nullable(),
  api_host: apiHostSchema.nullable(),
  evidence: z.array(securityEvidenceSchema).max(20),
  fingerprint: z.string().min(1).max(128),
}) satisfies z.ZodType<SecurityIssueInput>;

/** `CrawlAuditInput`. */
export const crawlAuditInputSchema = z.object({
  issues: z.array(securityIssueInputSchema).max(MAX_SECURITY_ISSUES),
  error: z.string().max(4000).optional(),
}) satisfies z.ZodType<CrawlAuditInput>;

/** Body of `POST /crawls`. Fingerprints must be unique within the audit. */
export const crawlRecordSchema = z
  .object({
    origin: originSchema,
    crawled_at: z.string().datetime({ offset: true }),
    job_id: z.string().min(1).max(100).optional(),
    audit: crawlAuditInputSchema.optional(),
  })
  .refine(
    (b) =>
      !b.audit ||
      new Set(b.audit.issues.map((i) => i.fingerprint)).size ===
        b.audit.issues.length,
    { message: 'Issue fingerprints must be unique', path: ['audit', 'issues'] }
  ) satisfies z.ZodType<CrawlRecordRequest>;

/** A comma-separated query value (`high,critical`) as a trimmed list. */
const commaList = z.string().transform((value) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);

/** `GET /crawls` query. `audited` is `true` or `false`. */
export const crawlListQuerySchema = z.object({
  origin: originSchema.optional(),
  audited: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** `GET /security-issues` and `GET /crawls/:id/security-issues` query. */
export const securityIssueListQuerySchema = z.object({
  origin: originSchema.optional(),
  severity: commaList.pipe(z.array(securitySeveritySchema).min(1)).optional(),
  category: commaList.pipe(z.array(securityCategorySchema).min(1)).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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

// -----------------------------------------------------------------------------
// Version 2: request and response schemas
// -----------------------------------------------------------------------------

/** Deepest nesting allowed in one schema. */
export const MAX_SCHEMA_DEPTH = 16;
/** Largest serialized input + responses of one endpoint, in characters. */
export const MAX_ENDPOINT_SCHEMA_CHARS = 200_000;

/** An HTTP header field name (RFC 9110 token). */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const jsonSchemaTypeSchema = z.enum([
  'string',
  'integer',
  'number',
  'boolean',
  'object',
  'array',
  'null',
]);

/** `HeaderRecipe`. */
export const headerRecipeSchema = z.object({
  summary: z.string().min(1).max(500),
  steps: z.array(z.string().min(1).max(2000)).min(1).max(30),
  inputs: z.array(z.string().min(1).max(200)).max(30),
  codeRef: z
    .object({
      script: z.string().min(1).max(500),
      line: z.number().int().min(1).optional(),
    })
    .optional(),
}) satisfies z.ZodType<HeaderRecipe>;

/** `HeaderSource`: each kind carries the field it needs. */
export const headerSourceSchema = z
  .object({
    kind: z.enum([
      'constant',
      'cookie',
      'storage',
      'response',
      'auth',
      'computed',
      'unknown',
    ]),
    value: z.string().max(4096).optional(),
    key: z.string().min(1).max(200).optional(),
    from: z
      .object({
        endpointId: z.string().min(1),
        field: z.string().min(1).max(500),
      })
      .optional(),
    recipe: headerRecipeSchema.optional(),
  })
  .superRefine((h, ctx) => {
    const need: Partial<Record<HeaderSource['kind'], keyof HeaderSource>> = {
      constant: 'value',
      cookie: 'key',
      storage: 'key',
      response: 'from',
      computed: 'recipe',
    };
    const field = need[h.kind];
    if (field && h[field] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `a ${h.kind} header needs "${field}"`,
      });
    }
  }) satisfies z.ZodType<HeaderSource>;

/** `ApiJsonSchema`, recursively; unknown keywords are kept. */
export const apiJsonSchemaSchema: z.ZodType<ApiJsonSchema> = z.lazy(() =>
  z
    .object({
      type: z
        .union([jsonSchemaTypeSchema, z.array(jsonSchemaTypeSchema).min(1)])
        .optional(),
      description: z.string().max(4000).optional(),
      properties: z.record(z.string(), apiJsonSchemaSchema).optional(),
      required: z.array(z.string()).optional(),
      items: apiJsonSchemaSchema.optional(),
      additionalProperties: z
        .union([z.boolean(), apiJsonSchemaSchema])
        .optional(),
      enum: z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional(),
      anyOf: z.array(apiJsonSchemaSchema).optional(),
      default: z.unknown().optional(),
      examples: z.array(z.unknown()).max(10).optional(),
      format: z.string().optional(),
      pattern: z.string().optional(),
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(0).optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      'x-raidr-header': headerSourceSchema.optional(),
      'x-raidr-evidence': z.enum(['code', 'traffic', 'both']).optional(),
    })
    .loose()
);

/** Nesting depth of a schema: 1 for a leaf. */
export function schemaDepth(schema: ApiJsonSchema): number {
  const children: ApiJsonSchema[] = [
    ...Object.values(schema.properties ?? {}),
    ...(schema.items ? [schema.items] : []),
    ...(typeof schema.additionalProperties === 'object'
      ? [schema.additionalProperties]
      : []),
    ...(schema.anyOf ?? []),
  ];
  return 1 + Math.max(0, ...children.map(schemaDepth));
}

/** An object schema whose property names match `nameRe`. */
const groupSchema = (nameRe: RegExp, what: string) =>
  apiJsonSchemaSchema.superRefine((group, ctx) => {
    for (const name of Object.keys(group.properties ?? {})) {
      if (!nameRe.test(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['properties', name],
          message: `"${name}" is not a valid ${what} name`,
        });
      }
    }
  });

/** `EndpointInputSchema`: groups by location; header properties say where their value comes from. */
export const endpointInputSchemaSchema = z
  .object({
    type: z.literal('object'),
    description: z.string().optional(),
    properties: z
      .object({
        path: groupSchema(
          /^[A-Za-z_][A-Za-z0-9_]*$/,
          'path parameter'
        ).optional(),
        query: apiJsonSchemaSchema.optional(),
        headers: groupSchema(HEADER_NAME_RE, 'header').optional(),
        body: apiJsonSchemaSchema.optional(),
      })
      .strict(),
    required: z.array(z.enum(['path', 'query', 'headers', 'body'])).optional(),
  })
  .loose()
  .superRefine((input, ctx) => {
    for (const [name, header] of Object.entries(
      input.properties.headers?.properties ?? {}
    )) {
      if (!header['x-raidr-header']) {
        ctx.addIssue({
          code: 'custom',
          path: ['properties', 'headers', 'properties', name],
          message: `header "${name}" needs x-raidr-header`,
        });
      }
    }
  }) satisfies z.ZodType<EndpointInputSchema>;

/** `EndpointResponse`. */
export const endpointResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  description: z.string().min(1).max(4000),
  contentType: z.string().optional(),
  schema: apiJsonSchemaSchema.optional(),
  example: z.string().max(8192).optional(),
}) satisfies z.ZodType<EndpointResponse>;

/** `ApiEndpointV2`: every `{param}` is a required path property; no GET body; bounded size. */
export const apiEndpointV2Schema = z
  .object({
    id: z.string().min(1),
    method: httpMethodSchema,
    path: apiPathSchema,
    summary: z.string().min(1),
    description: z.string().optional(),
    auth: z.enum(['none', 'user', 'api_key']),
    tag: z.string().optional(),
    role: z.literal('login').optional(),
    bodyEncoding: z
      .enum(['json', 'form', 'multipart', 'text'])
      .nullable()
      .optional(),
    input: endpointInputSchemaSchema,
    responses: z.array(endpointResponseSchema),
  })
  .superRefine((endpoint, ctx) => {
    if (endpoint.id !== `${endpoint.method} ${endpoint.path}`) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'id must be "METHOD path"',
      });
    }
    const body = endpoint.input.properties.body;
    if (endpoint.method === 'GET' && (endpoint.bodyEncoding || body)) {
      ctx.addIssue({
        code: 'custom',
        path: ['bodyEncoding'],
        message: 'GET requests cannot carry a body',
      });
    }
    if (body && !endpoint.bodyEncoding) {
      ctx.addIssue({
        code: 'custom',
        path: ['bodyEncoding'],
        message: 'an endpoint with a body needs bodyEncoding',
      });
    }
    const path = endpoint.input.properties.path;
    for (const param of extractPathParams(endpoint.path)) {
      if (!path?.properties?.[param] || !path.required?.includes(param)) {
        ctx.addIssue({
          code: 'custom',
          path: ['input', 'properties', 'path'],
          message: `path parameter "${param}" must be a required property`,
        });
      }
    }
    const schemas: ApiJsonSchema[] = [
      endpoint.input,
      ...endpoint.responses.flatMap((r) => (r.schema ? [r.schema] : [])),
    ];
    if (schemas.some((s) => schemaDepth(s) > MAX_SCHEMA_DEPTH)) {
      ctx.addIssue({
        code: 'custom',
        path: ['input'],
        message: `schemas nest deeper than ${MAX_SCHEMA_DEPTH} levels`,
      });
    }
    const size = JSON.stringify([endpoint.input, endpoint.responses]).length;
    if (size > MAX_ENDPOINT_SCHEMA_CHARS) {
      ctx.addIssue({
        code: 'custom',
        path: ['input'],
        message: `schemas are ${size} characters; the limit is ${MAX_ENDPOINT_SCHEMA_CHARS}`,
      });
    }
  }) satisfies z.ZodType<ApiEndpointV2>;

// -----------------------------------------------------------------------------
// Docs
// -----------------------------------------------------------------------------

const apiDocAuthSchema = z.object({
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
});

/** Doc-level fields both versions share. */
const apiDocBaseShape = {
  apiHost: apiHostSchema,
  baseUrl: z.string().url(),
  siteOrigins: z.array(originSchema),
  title: z.string().min(1),
  description: z.string(),
  auth: apiDocAuthSchema,
  links: z.array(endpointLinkSchema).max(5000).optional(),
  version: z.string().min(1),
  generatedAt: z.string().min(1),
  source: mcpSourceSchema,
};

/** Checks both versions share: baseUrl host, unique ids, links, auth coverage. */
function checkApiDoc(doc: ApiDoc, ctx: z.RefinementCtx): void {
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
  const endpoints: { id: string; auth: string }[] = doc.endpoints;
  const ids = new Set<string>();
  endpoints.forEach((e, i) => {
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
  if (endpoints.some((e) => e.auth === 'user') && !doc.auth.user) {
    ctx.addIssue({
      code: 'custom',
      path: ['auth', 'user'],
      message: 'user endpoints need auth.user',
    });
  }
  if (endpoints.some((e) => e.auth === 'api_key') && !doc.auth.apiKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['auth', 'apiKey'],
      message: 'api_key endpoints need auth.apiKey',
    });
  }
}

/** `ApiDocV1`: `baseUrl` host equals `apiHost`; endpoint ids are unique. */
export const apiDocV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ...apiDocBaseShape,
    endpoints: z.array(apiEndpointSchema),
  })
  .superRefine(checkApiDoc) satisfies z.ZodType<ApiDocV1>;

/** `ApiDocV2`: the same doc-level rules, version-2 endpoints. */
export const apiDocV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...apiDocBaseShape,
    endpoints: z.array(apiEndpointV2Schema),
    extractedBy: z.enum(['claude', 'codex', 'none']).optional(),
  })
  .superRefine(checkApiDoc) satisfies z.ZodType<ApiDocV2>;

/** `ApiDoc`, either version. */
export const apiDocSchema = z.union([
  apiDocV1Schema,
  apiDocV2Schema,
]) satisfies z.ZodType<ApiDoc>;

/** Body of `PUT /apis/:apiHost`. */
export const apiDocUpsertSchema = z.object({
  doc: apiDocSchema,
}) satisfies z.ZodType<ApiDocUpsertRequest>;

/** Body of `POST /apis/:apiHost/execute`. Credentials are bounded, never stored. */
/** `ApiExecuteInput`: values for a version-2 endpoint, by location. */
export const apiExecuteInputSchema = z.object({
  path: z.record(z.string(), z.unknown()).optional(),
  query: z.record(z.string(), z.unknown()).optional(),
  headers: z
    .record(z.string().regex(HEADER_NAME_RE), z.string().max(8192))
    .optional(),
  body: z.unknown().optional(),
}) satisfies z.ZodType<ApiExecuteInput>;

export const apiExecuteSchema = z.object({
  endpointId: z.string().min(1).max(500),
  params: z.record(z.string(), z.unknown()),
  input: apiExecuteInputSchema.optional(),
  extraBody: z.record(z.string(), z.unknown()).optional(),
  userToken: z.string().max(16384).optional(),
  apiKey: z.string().max(4096).optional(),
}) satisfies z.ZodType<ApiExecuteRequest>;
