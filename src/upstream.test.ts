import { describe, expect, it } from 'vitest';
import {
  MAX_UPSTREAM_BYTES,
  McpToolInputError,
  UpstreamBlockedError,
  applyAuth,
  assertSafeUpstream,
  buildUpstreamRequest,
  isPrivateAddress,
  parseHttpUrl,
  type McpManifest,
  type McpTool,
} from './index.js';

const manifest: McpManifest = {
  schemaVersion: 1,
  apiHost: 'api.example.com',
  baseUrl: 'https://api.example.com',
  siteOrigins: ['https://www.example.com'],
  title: 'Example API',
  description: 'Users',
  auth: { style: 'bearer' },
  staticHeaders: { 'x-client': 'raidr' },
  tools: [
    {
      name: 'list_users',
      description: 'List users',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          q: { type: 'string' },
          tag: { type: 'array' },
        },
      },
      request: {
        method: 'GET',
        pathTemplate: '/api/users',
        query: { page: 'page', q: 'q', tag: 'tag' },
      },
    },
    {
      name: 'get_user',
      description: 'Fetch one user',
      inputSchema: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      request: { method: 'GET', pathTemplate: '/api/users/{userId}' },
    },
    {
      name: 'create_user',
      description: 'Create a user',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          trace: { type: 'string' },
        },
      },
      request: {
        method: 'POST',
        pathTemplate: '/api/users',
        body: 'json',
        bodyFields: ['email', 'name'],
        headers: { trace: 'X-Trace' },
      },
    },
    {
      name: 'login',
      description: 'Form post',
      inputSchema: {
        type: 'object',
        properties: { user: { type: 'string' }, note: { type: 'string' } },
      },
      request: { method: 'POST', pathTemplate: '/login', body: 'form' },
    },
  ],
  version: '1',
  generatedAt: '2026-09-30T00:00:00.000Z',
  source: { bundleName: 'b.zip', crawlerVersion: '0.1.0' },
};

const tool = (name: string): McpTool =>
  manifest.tools.find((t) => t.name === name)!;

describe('buildUpstreamRequest', () => {
  it('fills path params with encoding and forwards bearer tokens', () => {
    const req = buildUpstreamRequest(
      manifest,
      tool('get_user'),
      { userId: 'a b/c' },
      'tok'
    );
    expect(req.url).toBe('https://api.example.com/api/users/a%20b%2Fc');
    expect(req.method).toBe('GET');
    expect(req.headers.Authorization).toBe('Bearer tok');
    expect(req.headers['x-client']).toBe('raidr');
    expect(req.body).toBeUndefined();
  });

  it('maps query inputs like URLSearchParams and skips null ones', () => {
    const args = { page: 2, q: "pad thai & (rice)!~*'", tag: ['a', 'b c'] };
    const req = buildUpstreamRequest(
      manifest,
      tool('list_users'),
      args,
      undefined
    );
    const expected = new URL('https://api.example.com/api/users');
    expected.searchParams.set('page', '2');
    expected.searchParams.set('q', args.q);
    for (const t of args.tag) expected.searchParams.append('tag', t);
    expect(req.url).toBe(expected.toString());
    expect(req.headers.Authorization).toBeUndefined();
    const none = buildUpstreamRequest(
      manifest,
      tool('list_users'),
      { page: null },
      undefined
    );
    expect(none.url).toBe('https://api.example.com/api/users');
  });

  it('sends only bodyFields as JSON and maps header inputs', () => {
    const req = buildUpstreamRequest(
      manifest,
      tool('create_user'),
      { email: 'e@x.y', name: 'E', trace: 't1', extra: 'no' },
      'tok'
    );
    expect(req.method).toBe('POST');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers['X-Trace']).toBe('t1');
    expect(JSON.parse(req.body!)).toEqual({ email: 'e@x.y', name: 'E' });
  });

  it('form-encodes a form body', () => {
    const req = buildUpstreamRequest(
      manifest,
      tool('login'),
      { user: 'a b', note: 'x&y' },
      undefined
    );
    expect(req.body).toBe(
      new URLSearchParams({ user: 'a b', note: 'x&y' }).toString()
    );
    expect(req.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
  });

  it('sends bodyArg as the whole body and adds the tool static headers', () => {
    const clips: McpTool = {
      name: 'add_clips',
      description: 'd',
      inputSchema: {
        type: 'object',
        properties: {
          playlist_id: { type: 'string' },
          clips: { type: 'array' },
        },
      },
      request: {
        method: 'POST',
        pathTemplate: '/playlists/{playlist_id}/clips',
        body: 'json',
        bodyArg: 'clips',
        staticHeaders: { 'X-Client': 'web/3.2' },
      },
    };
    const req = buildUpstreamRequest(
      manifest,
      clips,
      { playlist_id: 'p1', clips: ['c1', 'c2'] },
      undefined
    );
    expect(req.body).toBe('["c1","c2"]');
    // Header names compare case-insensitively: the tool's replaces the manifest's.
    expect(req.headers['X-Client']).toBe('web/3.2');
    expect(req.headers['x-client']).toBeUndefined();
  });

  it('keeps the base path and never leaves the api host', () => {
    const withPath = { ...manifest, baseUrl: 'https://api.example.com/v1/' };
    expect(
      buildUpstreamRequest(
        withPath,
        tool('get_user'),
        { userId: '7' },
        undefined
      ).url
    ).toBe('https://api.example.com/v1/api/users/7');
    for (const pathTemplate of [
      '//evil.com/{userId}',
      'https://evil.com/{userId}',
      '/a\\b',
    ]) {
      const evil: McpTool = {
        ...tool('get_user'),
        request: { method: 'GET', pathTemplate },
      };
      expect(() =>
        buildUpstreamRequest(manifest, evil, { userId: '7' }, 'tok')
      ).toThrow(McpToolInputError);
    }
    const otherHost = { ...manifest, baseUrl: 'https://evil.com' };
    expect(() =>
      buildUpstreamRequest(otherHost, tool('get_user'), { userId: '7' }, 'tok')
    ).toThrow(/api.example.com/);
  });

  it('throws a tool input error when a path param is missing', () => {
    expect(() =>
      buildUpstreamRequest(manifest, tool('get_user'), {}, undefined)
    ).toThrow(/userId/);
  });

  it('applies auth last, over a same-named static header', () => {
    const m: McpManifest = {
      ...manifest,
      staticHeaders: { authorization: 'Basic nope' },
    };
    const req = buildUpstreamRequest(
      m,
      tool('get_user'),
      { userId: '1' },
      'tok'
    );
    expect(req.headers).not.toHaveProperty('authorization');
    expect(req.headers.Authorization).toBe('Bearer tok');
  });
});

describe('applyAuth', () => {
  it('header, cookie, prefix and none styles', () => {
    const h1: Record<string, string> = {};
    applyAuth(h1, { style: 'header', headerName: 'X-Api-Key' }, 'k');
    expect(h1).toEqual({ 'X-Api-Key': 'k' });
    const h2: Record<string, string> = {};
    applyAuth(h2, { style: 'cookie', cookieName: 'sid' }, 'v');
    expect(h2).toEqual({ Cookie: 'sid=v' });
    const h3: Record<string, string> = {};
    applyAuth(h3, { style: 'none' }, 'v');
    expect(h3).toEqual({});
    const h4: Record<string, string> = {};
    applyAuth(h4, { style: 'bearer', tokenPrefix: 'JWT ' }, 'v');
    expect(h4).toEqual({ Authorization: 'JWT v' });
    const h5: Record<string, string> = {};
    applyAuth(h5, { style: 'bearer' }, undefined);
    expect(h5).toEqual({});
  });
});

describe('parseHttpUrl', () => {
  it('splits URLs and drops default ports', () => {
    expect(parseHttpUrl('https://API.example.com:443/v1?a=1#x')).toMatchObject({
      protocol: 'https',
      host: 'api.example.com',
      path: '/v1',
      query: 'a=1',
      hash: 'x',
      hasCredentials: false,
    });
    expect(parseHttpUrl('http://localhost:8080')).toMatchObject({
      host: 'localhost:8080',
      hostname: 'localhost',
      path: '/',
    });
    expect(parseHttpUrl('http://[::1]:3000/x')?.hostname).toBe('[::1]');
    expect(parseHttpUrl('https://u:p@h.com/')?.hasCredentials).toBe(true);
    expect(parseHttpUrl('ftp://h.com')).toBeNull();
    expect(parseHttpUrl('/relative')).toBeNull();
  });
});

describe('assertSafeUpstream', () => {
  const ok = (url: string, m = manifest, allowLocalhost = false) =>
    assertSafeUpstream(url, m, { allowLocalhost });

  it('accepts https on the manifest host', () => {
    expect(() => ok('https://api.example.com/api/users?x=1')).not.toThrow();
    expect(MAX_UPSTREAM_BYTES).toBe(1_000_000);
  });

  it('refuses other hosts, http and credentials', () => {
    expect(() => ok('https://evil.com/x')).toThrow(UpstreamBlockedError);
    expect(() => ok('https://api.example.com.evil.com/x')).toThrow(
      UpstreamBlockedError
    );
    expect(() => ok('https://user@api.example.com/x')).toThrow(
      UpstreamBlockedError
    );
    const http = { ...manifest, baseUrl: 'http://api.example.com' };
    expect(() => ok('http://api.example.com/x', http)).toThrow(/https/);
  });

  it('refuses literal private addresses and internal names', () => {
    for (const host of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.0.1',
      '[::1]',
      '[fd00::1]',
      '[::ffff:127.0.0.1]',
      'localhost',
      'printer.local',
      '2130706433',
      '0x7f.1',
    ]) {
      const m = { ...manifest, apiHost: host, baseUrl: `https://${host}` };
      expect(() => ok(`https://${host}/x`, m), host).toThrow(
        UpstreamBlockedError
      );
    }
    const pub = {
      ...manifest,
      apiHost: '93.184.216.34',
      baseUrl: 'https://93.184.216.34',
    };
    expect(() => ok('https://93.184.216.34/x', pub)).not.toThrow();
  });

  it('allows http loopback only with allowLocalhost', () => {
    const local = {
      ...manifest,
      apiHost: 'localhost:8080',
      baseUrl: 'http://localhost:8080',
    };
    expect(() => ok('http://localhost:8080/x', local)).toThrow();
    expect(() => ok('http://localhost:8080/x', local, true)).not.toThrow();
  });
});

describe('isPrivateAddress', () => {
  it('classifies v4 and v6 literals', () => {
    expect(isPrivateAddress('172.16.5.4')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
    expect(isPrivateAddress('example.com')).toBe(false);
  });
});
