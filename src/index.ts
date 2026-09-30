/**
 * @sudobility/raidr_types
 * TypeScript types for the raidr API - MCP manifests, skills and sites.
 *
 * The root export is plain types and tiny pure helpers. Zod schemas for the
 * same shapes live under `@sudobility/raidr_types/schemas` and need `zod`.
 */

import type { BaseResponse, PaginatedResponse } from '@sudobility/types';

// Re-export common types from @sudobility/types
export type {
  ApiResponse,
  BaseResponse,
  Optional,
  PaginatedResponse,
  PaginationInfo,
  PaginationOptions,
} from '@sudobility/types';

export * from './mcp.js';
export * from './entities.js';
export * from './constants.js';
export * from './paths.js';

// =============================================================================
// Response helpers
// =============================================================================

/**
 * Create a success envelope. The shape is `BaseResponse` from
 * `@sudobility/types` so every sudobility API answers the same way;
 * `timestamp` is stamped at call time.
 */
export function successResponse<T>(data: T): BaseResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create an error envelope. Typed `BaseResponse<never>` so it can be returned
 * from any handler regardless of that handler's success data type.
 */
export function errorResponse(error: string): BaseResponse<never> {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a paginated list response from an offset/limit window.
 *
 * `hasNextPage` is derived from `offset + items.length < totalCount`, so it is
 * correct even when the last page is short. `pageSize` reports the requested
 * `limit`, not `items.length`.
 */
export function paginatedResponse<T>(
  items: T[],
  window: { limit: number; offset: number; totalCount: number }
): PaginatedResponse<T> {
  return {
    success: true,
    data: items,
    timestamp: new Date().toISOString(),
    pagination: {
      hasNextPage: window.offset + items.length < window.totalCount,
      hasPreviousPage: window.offset > 0,
      pageSize: window.limit,
      totalCount: window.totalCount,
    },
  };
}
