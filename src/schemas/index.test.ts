import { describe, expect, it } from 'vitest';
import type { McpManifest } from '../index.js';
import {
  listQuerySchema,
  mcpManifestSchema,
  mcpToolSchema,
  originSchema,
  siteCreateSchema,
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
