import { describe, expect, it, test } from 'vitest';
import type { McpManifest } from '../index.js';
import {
  crawlJobClaimSchema,
  crawlJobCompleteSchema,
  crawlJobEnqueueSchema,
  crawlJobUpdateSchema,
  crawlListQuerySchema,
  crawlRecordSchema,
  listQuerySchema,
  mcpManifestSchema,
  mcpToolSchema,
  originSchema,
  securityIssueInputSchema,
  securityIssueListQuerySchema,
  siteCreateSchema,
  siteRouteSchema,
  siteUpsertSchema,
} from './index.js';

const tool = {
  name: 'get_user',
  description: 'Fetch a user',
  inputSchema: {
    type: 'object' as const,
    properties: { id: { type: 'string' }, expand: { type: 'boolean' } },
    required: ['id'],
  },
  request: {
    method: 'GET' as const,
    pathTemplate: '/api/users/{id}',
    query: { expand: 'expand' },
  },
};

const manifest: McpManifest = {
  schemaVersion: 1,
  apiHost: 'api.example.com',
  baseUrl: 'https://api.example.com',
  siteOrigins: ['https://www.example.com'],
  title: 'Example API',
  description: '',
  auth: { style: 'bearer' },
  tools: [tool],
  version: '1',
  generatedAt: '2026-09-30T00:00:00.000Z',
  source: { bundleName: 'raidr-www.example.com.zip', crawlerVersion: '0.1.0' },
};

describe('mcpManifestSchema', () => {
  it('accepts a valid manifest', () => {
    expect(mcpManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('rejects a baseUrl on another host', () => {
    const result = mcpManifestSchema.safeParse({
      ...manifest,
      baseUrl: 'https://other.example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a baseUrl with credentials or a non-http scheme', () => {
    for (const baseUrl of [
      'https://u:p@api.example.com',
      'ftp://api.example.com',
      'https://api.example.com/?x=1',
    ]) {
      expect(
        mcpManifestSchema.safeParse({ ...manifest, baseUrl }).success
      ).toBe(false);
    }
    expect(
      mcpManifestSchema.safeParse({
        ...manifest,
        baseUrl: 'https://api.example.com/v1',
      }).success
    ).toBe(true);
  });

  it('rejects duplicate tool names', () => {
    const result = mcpManifestSchema.safeParse({
      ...manifest,
      tools: [tool, tool],
    });
    expect(result.success).toBe(false);
  });

  it('requires headerName for header auth and cookieName for cookie auth', () => {
    expect(
      mcpManifestSchema.safeParse({ ...manifest, auth: { style: 'header' } })
        .success
    ).toBe(false);
    expect(
      mcpManifestSchema.safeParse({ ...manifest, auth: { style: 'cookie' } })
        .success
    ).toBe(false);
    expect(
      mcpManifestSchema.safeParse({
        ...manifest,
        auth: { style: 'cookie', cookieName: 'sid' },
      }).success
    ).toBe(true);
  });
});

describe('mcpToolSchema', () => {
  it('rejects path params missing from the input schema', () => {
    const result = mcpToolSchema.safeParse({
      ...tool,
      request: { method: 'GET', pathTemplate: '/api/users/{userId}' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects query mappings for unknown fields', () => {
    const result = mcpToolSchema.safeParse({
      ...tool,
      request: { ...tool.request, query: { missing: 'missing' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects path templates that name another host', () => {
    for (const pathTemplate of [
      '//evil.com/x',
      '/redirect?to=https://evil.com',
      '/\\evil.com',
    ]) {
      expect(
        mcpToolSchema.safeParse({
          ...tool,
          request: { method: 'GET', pathTemplate },
          inputSchema: { type: 'object', properties: {} },
        }).success
      ).toBe(false);
    }
  });

  it('rejects bad names and GET bodies', () => {
    expect(mcpToolSchema.safeParse({ ...tool, name: 'GetUser' }).success).toBe(
      false
    );
    expect(
      mcpToolSchema.safeParse({
        ...tool,
        request: { ...tool.request, body: 'json' },
      }).success
    ).toBe(false);
  });
});

describe('origin and list schemas', () => {
  it('accepts only bare origins', () => {
    expect(originSchema.safeParse('https://www.example.com').success).toBe(
      true
    );
    expect(originSchema.safeParse('https://www.example.com/path').success).toBe(
      false
    );
  });

  it('coerces and bounds list params', () => {
    expect(listQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(listQuerySchema.parse({ limit: '10', offset: '5', q: 'x' })).toEqual(
      { limit: 10, offset: 5, q: 'x' }
    );
    expect(listQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('validates site creation', () => {
    expect(
      siteCreateSchema.safeParse({
        origin: 'https://www.example.com',
        api_hosts: ['api.example.com'],
      }).success
    ).toBe(true);
    expect(
      siteCreateSchema.safeParse({ origin: 'example.com', api_hosts: [] })
        .success
    ).toBe(false);
  });
});

describe('crawl job schemas', () => {
  test('enqueue takes origins, not URLs with paths', () => {
    expect(
      crawlJobEnqueueSchema.safeParse({
        origins: ['https://suno.com'],
        force: true,
      }).success
    ).toBe(true);
    expect(
      crawlJobEnqueueSchema.safeParse({ origins: ['https://suno.com/create'] })
        .success
    ).toBe(false);
    expect(crawlJobEnqueueSchema.safeParse({ origins: [] }).success).toBe(
      false
    );
  });
  test('enqueue takes a mode: full, api or routes', () => {
    for (const mode of ['full', 'api', 'routes']) {
      expect(
        crawlJobEnqueueSchema.safeParse({ origins: ['https://suno.com'], mode })
          .success
      ).toBe(true);
    }
    expect(
      crawlJobEnqueueSchema.safeParse({
        origins: ['https://suno.com'],
        mode: 'skills',
      }).success
    ).toBe(false);
  });
  test('complete carries a result with the crawl time', () => {
    const ok = crawlJobCompleteSchema.safeParse({
      worker: 'w1',
      status: 'completed',
      result: {
        crawled_at: '2026-10-01T19:47:00.000Z',
        rendering: 'hybrid',
        pages: 10,
        scripts: 611,
        api_hosts: ['studio-api-prod.suno.com', 'suno.com'],
        tools: 134,
        skipped_hosts: 12,
        seconds: 274,
      },
    });
    expect(ok.success).toBe(true);
    expect(
      crawlJobCompleteSchema.safeParse({ worker: 'w1', status: 'crawling' })
        .success
    ).toBe(false);
  });
  test('an update changes mode or priority, and needs one of them', () => {
    expect(crawlJobUpdateSchema.safeParse({ mode: 'routes' }).success).toBe(
      true
    );
    expect(crawlJobUpdateSchema.safeParse({ priority: 5 }).success).toBe(true);
    expect(crawlJobUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      crawlJobUpdateSchema.safeParse({ headed_chrome: true }).success
    ).toBe(true);
    expect(
      crawlJobEnqueueSchema.safeParse({
        origins: ['https://suno.com'],
        headed_chrome: true,
      }).success
    ).toBe(true);
  });
  test('claim leases are bounded', () => {
    expect(
      crawlJobClaimSchema.safeParse({ worker: 'w', lease_seconds: 5 }).success
    ).toBe(false);
    expect(crawlJobClaimSchema.safeParse({ worker: 'w' }).success).toBe(true);
  });
});

describe('site route schemas', () => {
  const route = {
    url: 'https://suno.com/song/{id}',
    params: [{ name: 'id', description: "the song's id" }],
    query: [],
    description: 'Plays one song.',
    urlFields: [],
    sources: ['code'],
  };
  test('accepts a route whose params name its placeholders', () => {
    expect(siteRouteSchema.safeParse(route).success).toBe(true);
    expect(
      siteRouteSchema.safeParse({
        ...route,
        url: 'https://suno.com/me',
        params: [],
      }).success
    ).toBe(true);
  });
  test('params must match the placeholders, in order', () => {
    expect(siteRouteSchema.safeParse({ ...route, params: [] }).success).toBe(
      false
    );
    expect(
      siteRouteSchema.safeParse({
        ...route,
        url: 'https://suno.com/a/{x}/b/{y}',
        params: [
          { name: 'y', description: null },
          { name: 'x', description: null },
        ],
      }).success
    ).toBe(false);
  });
  test('rejects relative URLs, queries and bad placeholders', () => {
    for (const url of [
      '/song/{id}',
      'ftp://suno.com/{id}',
      'https://suno.com/song/{id}?wid=1',
      'https://suno.com/song/{bad-name}',
    ]) {
      expect(siteRouteSchema.safeParse({ ...route, url }).success, url).toBe(
        false
      );
    }
  });
  test('param sources: kept as given, default [] for older routes', () => {
    const source = {
      apiHost: 'api.lu.ma',
      endpoint: 'GET /discover/events',
      field: 'entries[].event.url',
    };
    const withSources = siteRouteSchema.safeParse({
      ...route,
      params: [{ name: 'id', description: null, sources: [source] }],
    });
    expect(withSources.success).toBe(true);
    expect(withSources.data?.params[0].sources).toEqual([source]);
    const old = siteRouteSchema.safeParse(route);
    expect(old.success).toBe(true);
    expect(old.data?.params[0].sources).toEqual([]);
  });
  test('param sources are bounded and well-formed', () => {
    const source = { apiHost: 'api.lu.ma', endpoint: 'GET /e', field: 'url' };
    expect(
      siteRouteSchema.safeParse({
        ...route,
        params: [
          { name: 'id', description: null, sources: Array(6).fill(source) },
        ],
      }).success
    ).toBe(false);
    expect(
      siteRouteSchema.safeParse({
        ...route,
        params: [
          {
            name: 'id',
            description: null,
            sources: [{ ...source, field: '' }],
          },
        ],
      }).success
    ).toBe(false);
  });
  test('needs at least one distinct source', () => {
    expect(siteRouteSchema.safeParse({ ...route, sources: [] }).success).toBe(
      false
    );
    expect(
      siteRouteSchema.safeParse({ ...route, sources: ['code', 'code'] }).success
    ).toBe(false);
  });
  test('site upserts take optional routes with unique urls', () => {
    expect(
      siteUpsertSchema.safeParse({ api_hosts: [], routes: [route] }).success
    ).toBe(true);
    expect(siteUpsertSchema.safeParse({ api_hosts: [] }).success).toBe(true);
    expect(
      siteUpsertSchema.safeParse({ api_hosts: [], routes: [route, route] })
        .success
    ).toBe(false);
  });
});

describe('crawl record and security issue schemas', () => {
  const issue = {
    rule: 'secret-in-code',
    category: 'secrets' as const,
    severity: 'high' as const,
    confidence: 'medium' as const,
    title: 'Stripe secret key in JavaScript',
    description: 'A live secret key ships to every visitor.',
    recommendation: 'Revoke the key and keep it on the server.',
    cwe: 'CWE-798',
    owasp: 'A07:2021',
    api_host: null,
    evidence: [
      {
        kind: 'code' as const,
        file: 'app.js',
        line: 12,
        snippet: 'sk_live_ab…yz',
      },
    ],
    fingerprint: 'secret-in-code:stripe:ab12',
  };

  it('accepts a crawl with and without an audit', () => {
    const base = {
      origin: 'https://example.com',
      crawled_at: '2026-10-06T01:43:34.211Z',
    };
    expect(crawlRecordSchema.safeParse(base).success).toBe(true);
    expect(
      crawlRecordSchema.safeParse({
        ...base,
        job_id: 'j1',
        audit: { issues: [issue] },
      }).success
    ).toBe(true);
    expect(
      crawlRecordSchema.safeParse({
        ...base,
        audit: { issues: [], error: 'timed out' },
      }).success
    ).toBe(true);
  });

  it('rejects duplicate fingerprints, bad ids and a non-origin', () => {
    const base = {
      origin: 'https://example.com',
      crawled_at: '2026-10-06T01:43:34.211Z',
    };
    expect(
      crawlRecordSchema.safeParse({
        ...base,
        audit: { issues: [issue, issue] },
      }).success
    ).toBe(false);
    expect(
      securityIssueInputSchema.safeParse({ ...issue, cwe: '798' }).success
    ).toBe(false);
    expect(
      securityIssueInputSchema.safeParse({ ...issue, owasp: 'A7' }).success
    ).toBe(false);
    expect(
      securityIssueInputSchema.safeParse({ ...issue, rule: 'Secret In Code' })
        .success
    ).toBe(false);
    expect(
      crawlRecordSchema.safeParse({ ...base, origin: 'https://example.com/x' })
        .success
    ).toBe(false);
  });

  it('reads list queries', () => {
    expect(crawlListQuerySchema.parse({ audited: 'true' })).toEqual({
      audited: true,
      limit: 50,
      offset: 0,
    });
    expect(
      securityIssueListQuerySchema.parse({
        severity: 'high, critical',
        category: 'secrets',
      })
    ).toMatchObject({ severity: ['high', 'critical'], category: ['secrets'] });
    expect(
      securityIssueListQuerySchema.safeParse({ severity: 'urgent' }).success
    ).toBe(false);
  });

  it('takes audit on enqueue and update, and the audit mode', () => {
    expect(
      crawlJobEnqueueSchema.safeParse({
        origins: ['https://a.com'],
        audit: true,
        mode: 'audit',
      }).success
    ).toBe(true);
    expect(crawlJobUpdateSchema.safeParse({ audit: true }).success).toBe(true);
  });
});
