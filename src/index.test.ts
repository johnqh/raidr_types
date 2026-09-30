import { describe, expect, it } from 'vitest';
import {
  errorResponse,
  extractPathParams,
  fillPathTemplate,
  mcpProxyUrl,
  paginatedResponse,
  successResponse,
} from './index.js';

describe('response helpers', () => {
  it('wraps data in a success envelope', () => {
    const response = successResponse({ a: 1 });
    expect(response.success).toBe(true);
    expect(response.data).toEqual({ a: 1 });
    expect(typeof response.timestamp).toBe('string');
  });

  it('wraps an error message', () => {
    const response = errorResponse('nope');
    expect(response.success).toBe(false);
    expect(response.error).toBe('nope');
  });

  it('computes pagination flags from the window', () => {
    const page = paginatedResponse([1, 2], {
      limit: 2,
      offset: 2,
      totalCount: 5,
    });
    expect(page.pagination).toEqual({
      hasNextPage: true,
      hasPreviousPage: true,
      totalCount: 5,
      pageSize: 2,
    });
    const last = paginatedResponse([5], { limit: 2, offset: 4, totalCount: 5 });
    expect(last.pagination.hasNextPage).toBe(false);
  });
});

describe('path helpers', () => {
  it('extracts unique params in order', () => {
    expect(extractPathParams('/a/{id}/b/{slug}/{id}')).toEqual(['id', 'slug']);
    expect(extractPathParams('/plain')).toEqual([]);
  });

  it('fills and encodes params', () => {
    expect(fillPathTemplate('/u/{id}/x', { id: 'a b' })).toBe('/u/a%20b/x');
    expect(() => fillPathTemplate('/u/{id}', {})).toThrow(/id/);
  });

  it('builds the proxy url', () => {
    expect(mcpProxyUrl('https://api.raidr.app/', 'api.example.com')).toBe(
      'https://api.raidr.app/mcp/api.example.com'
    );
  });
});
