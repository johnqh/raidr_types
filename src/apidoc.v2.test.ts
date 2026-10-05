import { describe, expect, it } from 'vitest';
import { isApiDocV2, type ApiDocV2, type ApiEndpointV2 } from './index.js';
import {
  apiDocSchema,
  apiEndpointV2Schema,
  apiExecuteSchema,
  headerSourceSchema,
  schemaDepth,
} from './schemas/index.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const endpoint: ApiEndpointV2 = {
  id: 'POST /v2/orders/{order_id}/items',
  method: 'POST',
  path: '/v2/orders/{order_id}/items',
  summary: 'Add an item to an order',
  auth: 'user',
  bodyEncoding: 'json',
  input: {
    type: 'object',
    properties: {
      path: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            format: 'uuid',
            description: 'The order',
          },
        },
        required: ['order_id'],
      },
      headers: {
        type: 'object',
        properties: {
          'x-signature': {
            type: 'string',
            description: 'Request signature',
            'x-raidr-header': {
              kind: 'computed',
              recipe: {
                summary: 'HMAC-SHA256 of method + path + timestamp',
                steps: [
                  'Join method, path and x-ts with newlines',
                  'HMAC-SHA256 with the app key',
                  'Hex encode',
                ],
                inputs: ['method', 'path', 'x-ts', 'app key'],
                codeRef: { script: 'chunks/012-main.js', line: 4410 },
              },
            },
          },
          'x-app-version': {
            type: 'string',
            description: 'Client version',
            'x-raidr-header': { kind: 'constant', value: '3.2.1' },
          },
        },
        required: ['x-signature'],
      },
      body: {
        type: 'object',
        description: 'The item to add',
        properties: {
          sku: {
            type: 'string',
            description: 'Product SKU',
            'x-raidr-evidence': 'both',
          },
          options: {
            type: 'array',
            description: 'Chosen options',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: ['string', 'null'] },
              },
            },
          },
        },
        required: ['sku'],
      },
    },
    required: ['path', 'body'],
  },
  responses: [
    {
      status: 201,
      description: 'The updated order',
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Order id' } },
      },
    },
    { status: 409, description: 'The item is out of stock' },
  ],
};

const doc: ApiDocV2 = {
  schemaVersion: 2,
  apiHost: 'api.shop.example',
  baseUrl: 'https://api.shop.example',
  siteOrigins: ['https://shop.example'],
  title: 'Shop API',
  description: 'd',
  auth: { user: { style: 'bearer' } },
  endpoints: [endpoint],
  version: '1',
  generatedAt: '2026-10-03T00:00:00Z',
  source: { bundleName: 'b', crawlerVersion: '0.2.0' },
  extractedBy: 'claude',
};

describe('version-2 api docs', () => {
  it('accepts a full endpoint and doc', () => {
    expect(apiEndpointV2Schema.safeParse(endpoint).success).toBe(true);
    expect(apiDocSchema.safeParse(doc).success).toBe(true);
    expect(isApiDocV2(doc)).toBe(true);
  });

  it('requires every path placeholder as a required path property', () => {
    const bad = clone(endpoint);
    bad.input.properties.path!.required = [];
    expect(apiEndpointV2Schema.safeParse(bad).success).toBe(false);
  });

  it('requires a header source on every header', () => {
    const bad = clone(endpoint);
    delete bad.input.properties.headers!.properties!['x-app-version']![
      'x-raidr-header'
    ];
    expect(apiEndpointV2Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects a body on GET and a body without an encoding', () => {
    const get = {
      ...clone(endpoint),
      method: 'GET' as const,
      id: 'GET /v2/orders/{order_id}/items',
    };
    expect(apiEndpointV2Schema.safeParse(get).success).toBe(false);
    const noEncoding = { ...clone(endpoint), bodyEncoding: null };
    expect(apiEndpointV2Schema.safeParse(noEncoding).success).toBe(false);
  });

  it('checks each header kind has its field', () => {
    expect(headerSourceSchema.safeParse({ kind: 'cookie' }).success).toBe(
      false
    );
    expect(
      headerSourceSchema.safeParse({ kind: 'cookie', key: 'csrftoken' }).success
    ).toBe(true);
    expect(headerSourceSchema.safeParse({ kind: 'auth' }).success).toBe(true);
    expect(headerSourceSchema.safeParse({ kind: 'computed' }).success).toBe(
      false
    );
  });

  it('measures and bounds nesting', () => {
    expect(schemaDepth(endpoint.input)).toBe(5);
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 20; i++)
      deep = { type: 'object', properties: { a: deep } };
    const bad = clone(endpoint);
    bad.input.properties.body = deep;
    expect(apiEndpointV2Schema.safeParse(bad).success).toBe(false);
  });

  it('accepts grouped execute input', () => {
    expect(
      apiExecuteSchema.safeParse({
        endpointId: endpoint.id,
        params: {},
        input: {
          path: { order_id: 'o1' },
          headers: { 'x-ts': '1' },
          body: [1, 2],
        },
      }).success
    ).toBe(true);
    expect(
      apiExecuteSchema.safeParse({
        endpointId: endpoint.id,
        params: {},
        input: { headers: { 'bad header': 'x' } },
      }).success
    ).toBe(false);
  });
});
