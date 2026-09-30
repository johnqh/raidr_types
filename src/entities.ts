/**
 * Database rows as they appear on the wire, plus request and query shapes for
 * raidr_api. Timestamps are `Date | null` in the database model and ISO 8601
 * strings in API responses.
 */

import type { McpManifest, McpSource } from './mcp';

// =============================================================================
// Entity rows
// =============================================================================

export interface Mcp {
  api_host: string;
  manifest: McpManifest;
  title: string | null;
  description: string | null;
  version: string | null;
  source: McpSource | null;
  created_at: Date | null;
  updated_at: Date | null;
}

/** List row: the manifest is omitted and replaced by its tool count. */
export type McpSummary = Omit<Mcp, 'manifest'> & { tool_count: number };

export interface Skill {
  api_host: string;
  name: string;
  description: string | null;
  markdown: string;
  version: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

/** List row: the markdown body is omitted. */
export type SkillSummary = Omit<Skill, 'markdown'>;

export interface Site {
  /** Crawled origin, e.g. `https://www.example.com`. */
  origin: string;
  title: string | null;
  description: string | null;
  /** API hosts this site was observed calling; each may have an Mcp row. */
  api_hosts: string[];
  last_crawled_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

// =============================================================================
// Request bodies
// =============================================================================

/** Body for POST /mcps and PUT /mcps/:apiHost. Columns derive from the manifest. */
export interface McpUpsertRequest {
  manifest: McpManifest;
}

/** Body for PUT /skills/:apiHost. */
export interface SkillUpsertRequest {
  name: string;
  description?: string;
  markdown: string;
  version?: string;
}

/** Body for POST /skills. */
export interface SkillCreateRequest extends SkillUpsertRequest {
  api_host: string;
}

/** Body for PUT /sites/:origin. */
export interface SiteUpsertRequest {
  title?: string;
  description?: string;
  api_hosts: string[];
  /** ISO 8601 timestamp. */
  last_crawled_at?: string;
}

/** Body for POST /sites. */
export interface SiteCreateRequest extends SiteUpsertRequest {
  origin: string;
}

// =============================================================================
// Query parameters
// =============================================================================

export interface ListQueryParams {
  /** Case-insensitive substring match on host, title and description. */
  q?: string;
  /** Default 50, maximum 200. */
  limit?: number;
  offset?: number;
}

export interface SiteListQueryParams extends ListQueryParams {
  /** Only sites that call this API host. */
  apiHost?: string;
}

// =============================================================================
// Health
// =============================================================================

export interface HealthCheckData {
  name: string;
  version: string;
  status: 'healthy';
}
