/**
 * Database rows as they appear on the wire, plus request and query shapes for
 * raidr_api. Timestamps are `Date | null` in the database model and ISO 8601
 * strings in API responses.
 */

import type { McpManifest, McpSource } from './mcp.js';

// =============================================================================
// Entity rows
// =============================================================================

/**
 * Row of the `mcps` table. `title`, `description`, `version` and `source` are
 * copies of manifest fields, denormalized so lists need not load the manifest.
 */
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

/** Row of the `skills` table: one agent skill (SKILL.md) per API host. */
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

/** Row of the `sites` table: a crawled origin and the API hosts it calls. */
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
// Crawl jobs (the work queue)
// =============================================================================

/**
 * - `queued`: waiting for a worker.
 * - `running`: claimed; `lease_until` says until when. A job whose lease ran
 *   out goes back to the queue (up to `CRAWL_JOB_MAX_ATTEMPTS` attempts).
 * - `done`: crawled and processed; the site's `last_crawled_at` was set.
 * - `failed`: gave up; enqueue it again to retry.
 */
export type CrawlJobStatus = 'queued' | 'running' | 'done' | 'failed';

/** What a worker reports when a job finishes; stored on the job. */
export interface CrawlJobResult {
  /** ISO 8601: when the site was actually crawled (the bundle's start time). */
  crawled_at: string | null;
  /** Rendering verdict: client-api, hybrid, server-rendered or unknown. */
  rendering: string | null;
  pages: number | null;
  scripts: number | null;
  /** API hosts that got an MCP server and skill from this crawl. */
  api_hosts: string[];
  tools: number;
  /** API hosts seen but not published (infrastructure, too few endpoints). */
  skipped_hosts: number;
  seconds: number;
}

/**
 * Row of the `crawl_jobs` table. One row per attempt to crawl an origin;
 * history is kept, and at most one row per origin is `queued` or `running`.
 */
export interface CrawlJob {
  id: string;
  origin: string;
  status: CrawlJobStatus;
  /** Crawl even though the site was crawled before. */
  force: boolean;
  /** Higher runs first; ties run oldest first. */
  priority: number;
  attempts: number;
  /** Free text: who asked (`raidr-crawler`, `raidr-app`, a user id ...). */
  requested_by: string | null;
  /** Worker id that holds or last held the job. */
  worker: string | null;
  lease_until: Date | null;
  result: CrawlJobResult | null;
  error: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
}

/** Body of `POST /crawl-jobs`. */
export interface CrawlJobEnqueueRequest {
  origins: string[];
  /** Queue sites that were crawled before. Default false. */
  force?: boolean;
  priority?: number;
  requested_by?: string;
}

/**
 * Per-origin outcome of an enqueue:
 * - `queued`: a new job was created.
 * - `already-queued`: a job is queued or running already (`force` upgrades it).
 * - `already-crawled`: the site has `last_crawled_at` and `force` was not set.
 */
export interface CrawlJobEnqueueResult {
  origin: string;
  outcome: 'queued' | 'already-queued' | 'already-crawled';
  job: CrawlJob | null;
  last_crawled_at: Date | null;
}

/** Body of `POST /crawl-jobs/claim`. */
export interface CrawlJobClaimRequest {
  worker: string;
  /** Default 1800 (30 minutes). */
  lease_seconds?: number;
}

/** Body of `POST /crawl-jobs/:id/heartbeat`. */
export interface CrawlJobHeartbeatRequest {
  worker: string;
  lease_seconds?: number;
}

/** Body of `POST /crawl-jobs/:id/complete`. */
export interface CrawlJobCompleteRequest {
  worker: string;
  status: 'done' | 'failed';
  result?: CrawlJobResult;
  error?: string;
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

/** Query string for list routes. The schema coerces strings to numbers. */
export interface ListQueryParams {
  /**
   * Case-insensitive substring match. raidr_api matches the key column
   * (`api_host` or `origin`), then `title` (`name` for skills), then
   * `description`.
   */
  q?: string;
  /** Default 50, maximum 200. */
  limit?: number;
  offset?: number;
}

/** Query string for `GET /crawl-jobs`. `q` matches the origin. */
export interface CrawlJobListQueryParams extends ListQueryParams {
  status?: CrawlJobStatus;
}

/** Query string for `GET /sites`. */
export interface SiteListQueryParams extends ListQueryParams {
  /** Only sites that call this API host. */
  apiHost?: string;
}

// =============================================================================
// Health
// =============================================================================

/** Payload of raidr_api's `GET /` and `GET /health`. */
export interface HealthCheckData {
  name: string;
  version: string;
  status: 'healthy';
}
