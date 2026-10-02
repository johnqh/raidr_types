import { describe, expect, it } from 'vitest';
import { endpointRef, parseEndpointRef, type ApiDoc } from './index.js';
import { apiDocSchema, apiExecuteSchema } from './schemas/index.js';

const doc: ApiDoc = {
  schemaVersion: 1,
  apiHost: 'studio-api.example.com',
  baseUrl: 'https://studio-api.example.com',
  siteOrigins: ['https://www.example.com'],
  title: 'Example API',
  description: 'd',
  auth: { user: { style: 'bearer', loginUrl: 'https://www.example.com' } },
  endpoints: [
    {
      id: 'GET /api/clip/{clip_id}',
      method: 'GET',
      path: '/api/clip/{clip_id}',
      summary: 'Get a clip',
      auth: 'user',
      params: [
        {
          name: 'clip_id',
          in: 'path',
          type: 'string',
          required: true,
          format: 'uuid',
        },
        {
          name: 'sort',
          in: 'query',
          type: 'enum',
          required: false,
          enum: ['new', 'top'],
          enumExhaustive: false,
        },
      ],
      responses: [{ status: 200, fields: ['id', 'title'] }],
    },
  ],
  version: '1',
  generatedAt: '2026-10-02T00:00:00.000Z',
  source: { bundleName: 'b.zip', crawlerVersion: '0.1.6' },
};

describe('apiDocSchema', () => {
  it('accepts a valid doc', () => {
    expect(apiDocSchema.safeParse(doc).success).toBe(true);
  });
  it('rejects an undocumented path parameter, an empty enum and a missing auth block', () => {
    const bad = JSON.parse(JSON.stringify(doc)) as ApiDoc;
    bad.endpoints[0]!.params = [
      { name: 'sort', in: 'query', type: 'enum', required: false, enum: [] },
    ];
    bad.auth = {};
    const issues = apiDocSchema
      .safeParse(bad)
      .error!.issues.map((i) => i.message);
    expect(issues).toContain('path parameter "clip_id" is not documented');
    expect(issues).toContain('an enum parameter lists its values');
    expect(issues).toContain('user endpoints need auth.user');
  });
  it('rejects an id that is not "METHOD path" and a host mismatch', () => {
    const bad = JSON.parse(JSON.stringify(doc)) as ApiDoc;
    bad.endpoints[0]!.id = 'get_clip';
    bad.baseUrl = 'https://evil.example.net';
    const issues = apiDocSchema
      .safeParse(bad)
      .error!.issues.map((i) => i.message);
    expect(issues).toContain('id must be "METHOD path"');
    expect(issues.some((m) => m.startsWith('baseUrl host must equal'))).toBe(
      true
    );
  });
});

describe('endpoint references', () => {
  it('round-trips method, host and path', () => {
    const ref = endpointRef(
      'https://studio-api.example.com/',
      doc.endpoints[0]!
    );
    expect(ref).toBe('GET https://studio-api.example.com/api/clip/{clip_id}');
    expect(parseEndpointRef(ref)).toEqual({
      method: 'GET',
      apiHost: 'studio-api.example.com',
      origin: 'https://studio-api.example.com',
      path: '/api/clip/{clip_id}',
    });
    expect(parseEndpointRef('FETCH https://x/y')).toBeNull();
    expect(parseEndpointRef('GET not-a-url')).toBeNull();
  });
});

describe('apiExecuteSchema', () => {
  it('bounds credentials', () => {
    expect(
      apiExecuteSchema.safeParse({
        endpointId: 'GET /x',
        params: {},
        userToken: 'x'.repeat(20000),
      }).success
    ).toBe(false);
    expect(
      apiExecuteSchema.safeParse({ endpointId: 'GET /x', params: { a: 1 } })
        .success
    ).toBe(true);
  });
});

describe('apiDocSchema links', () => {
  it('accepts links into the doc, including from another host', () => {
    const withLinks = JSON.parse(JSON.stringify(doc)) as ApiDoc;
    withLinks.endpoints.push({
      id: 'GET /api/feed',
      method: 'GET',
      path: '/api/feed',
      summary: 'List feed',
      auth: 'user',
      params: [],
      responses: [],
    });
    withLinks.links = [
      {
        from: {
          apiHost: 'studio-api.example.com',
          endpointId: 'GET /api/feed',
        },
        to: {
          apiHost: 'studio-api.example.com',
          endpointId: 'GET /api/clip/{clip_id}',
        },
        kind: 'data',
        evidence: 'inferred',
        toParam: 'clip_id',
      },
      {
        from: { apiHost: 'auth.example.com', endpointId: 'POST /v1/sign_in' },
        to: { apiHost: 'studio-api.example.com', endpointId: 'GET /api/feed' },
        kind: 'auth',
        evidence: 'observed',
        count: 3,
      },
    ];
    expect(apiDocSchema.safeParse(withLinks).success).toBe(true);
  });
  it('rejects a link that ends elsewhere or loops', () => {
    const bad = JSON.parse(JSON.stringify(doc)) as ApiDoc;
    bad.links = [
      {
        from: { apiHost: 'x.example.com', endpointId: 'GET /a' },
        to: { apiHost: 'x.example.com', endpointId: 'GET /b' },
        kind: 'data',
        evidence: 'inferred',
      },
      {
        from: { apiHost: bad.apiHost, endpointId: bad.endpoints[0]!.id },
        to: { apiHost: bad.apiHost, endpointId: bad.endpoints[0]!.id },
        kind: 'data',
        evidence: 'inferred',
      },
    ];
    const issues = apiDocSchema
      .safeParse(bad)
      .error!.issues.map((i) => i.message);
    expect(issues).toContain("a link must end at one of this doc's endpoints");
    expect(issues).toContain('an endpoint cannot feed itself');
  });
});
