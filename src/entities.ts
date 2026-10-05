/**
 * Database rows as they appear on the wire, plus request and query shapes for
 * raidr_api. Timestamps are `Date | null` in the database model and ISO 8601
 * strings in API responses.
 */

import type { HttpMethod, McpManifest, McpSource } from './mcp.js';
import type {
  ApiDoc,
  BodyEncoding,
  EndpointAuth,
  EndpointInputSchema,
  EndpointResponse,
} from './apidoc.js';

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
  /** Copy of `manifest.labels`, indexed for `GET /mcps?label=`. */
  labels: string[];
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
  /** What the site is about (`recipes`, `banking`), as lowercase slugs. */
  labels: string[];
  last_crawled_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

/**
 * How a site route was found, strongest first:
 * - `router`: the app's route table (a router config, a Next.js page).
 * - `code`: the app's code builds the URL for a link, a navigation or a share.
 * - `response`: an API response carried the full URL (a `share_url` field).
 * - `visited`: the crawl loaded a page at this URL.
 * - `link`: a page linked to it.
 */
export type SiteRouteSource =
  'router' | 'code' | 'response' | 'visited' | 'link';

/** A `{name}` placeholder in a `SiteRoute.url`. */
export interface SiteRouteParam {
  name: string;
  /** What value goes there (`"the song's id"`); null when unknown. */
  description: string | null;
}

/** An API response field that holds a site route's full URL. */
export interface SiteRouteUrlField {
  apiHost: string;
  /** Endpoint key, `"GET /api/clip/{id}"`. */
  endpoint: string;
  /** Dotted path into the response body, `[]` for array items: `clips[].share_url`. */
  field: string;
}

/**
 * A page URL the site's own UI handles, to send a person to the site itself
 * ("See it on Suno"): `https://suno.com/song/{id}`.
 */
export interface SiteRoute {
  /** Absolute URL template: origin plus path, each path parameter as `{name}`. */
  url: string;
  /** The `{name}` placeholders of `url`, in order. */
  params: SiteRouteParam[];
  /** Query parameter names the app adds to this URL (`wid`). */
  query: string[];
  /** What the page is for, one sentence; null when unknown. */
  description: string | null;
  /** Response fields seen holding this page's full URL; use them as-is when present. */
  urlFields: SiteRouteUrlField[];
  /** How it was found, strongest first; at least one. */
  sources: SiteRouteSource[];
}

/**
 * Row of the `api_docs` table: the endpoint documentation for one API host.
 * `title`, `description`, `version` and `source` are copies of doc fields.
 */
export interface ApiDocRow {
  api_host: string;
  doc: ApiDoc;
  title: string | null;
  description: string | null;
  endpoint_count: number;
  version: string | null;
  source: McpSource | null;
  created_at: Date | null;
  updated_at: Date | null;
}

/** List and public view: no doc body. */
export type ApiDocSummary = Omit<ApiDocRow, 'doc'>;

/**
 * @description Row of the `api_endpoints` table: one endpoint of a version-2
 * doc. A version-2 doc's `endpoints` are stored here, not in `api_docs.doc`,
 * and a publish replaces all of a host's rows at once.
 */
export interface ApiEndpointRow {
  /** API host the endpoint belongs to (`api_docs.api_host`). */
  api_host: string;
  /** `METHOD path`, unique per host; `ApiEndpointV2.id`. */
  endpoint_id: string;
  /** HTTP method, split out for queries. */
  method: HttpMethod;
  /** Path template, split out for queries. */
  path: string;
  /** One line: what the endpoint does. */
  summary: string;
  /** Longer explanation, when the site's code says more. */
  description: string | null;
  /** Grouping label. */
  tag: string | null;
  /** `login` for the call that signs a user in. */
  role: 'login' | null;
  /** Credential the endpoint needs. */
  auth: EndpointAuth;
  /** Request body encoding; null when the endpoint takes no body. */
  body_encoding: BodyEncoding | null;
  /** Path, query, headers and body. */
  input_schema: EndpointInputSchema;
  /** One entry per status the site's code handles. */
  output_schemas: EndpointResponse[];
  /** When the row was first written. */
  created_at: Date | null;
  /** When the row was last replaced. */
  updated_at: Date | null;
}

/** Body of `PUT /apis/:apiHost`. */
export interface ApiDocUpsertRequest {
  doc: ApiDoc;
}

/** Body of `POST /apis/:apiHost/execute`: run one endpoint through raidr's proxy. */
export interface ApiExecuteRequest {
  /** `ApiEndpoint.id`. */
  endpointId: string;
  /** Version 1: values by `ApiParam.name`; omitted or null values are not sent. */
  params: Record<string, unknown>;
  /**
   * Version 2: values grouped as `EndpointInputSchema` (`path`, `query`,
   * `headers`, `body`); replaces `params` and `extraBody`.
   */
  input?: ApiExecuteInput;
  /** Extra body fields, for endpoints with `additionalBody`. */
  extraBody?: Record<string, unknown>;
  /** The signed-in user's token for `user` endpoints. Never stored. */
  userToken?: string;
  /** The application key for `api_key` endpoints. Never stored. */
  apiKey?: string;
}

/** Values for a version-2 endpoint, grouped like its `EndpointInputSchema`. */
export interface ApiExecuteInput {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Any JSON value; sent with the endpoint's `bodyEncoding`. */
  body?: unknown;
}

/** What the upstream answered. */
export interface ApiExecuteResult {
  method: string;
  /** The URL that was called (credentials in query parameters are masked). */
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType: string | null;
  /** Response text; pretty-printed when it is JSON. */
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
}

// =============================================================================
// Crawl jobs (the work queue)
// =============================================================================

/**
 * - `pending`: waiting for a worker.
 * - `crawling`: claimed; `lease_until` says until when. A job whose lease ran
 *   out goes back to the queue (up to `CRAWL_JOB_MAX_ATTEMPTS` attempts).
 * - `completed`: crawled and published; the site's `last_crawled_at` was set.
 * - `failed`: gave up; `error` says why. It blocks nothing: the origin can be
 *   enqueued again at once, and the site is not marked crawled.
 */
export type CrawlJobStatus = 'pending' | 'crawling' | 'completed' | 'failed';

/**
 * What a crawl job produces:
 * - `full`: API docs, MCP servers and skills, and the site's page routes.
 * - `api`: API docs, MCP servers and skills only (stored routes are kept).
 * - `routes`: the site's page routes only (stored hosts, docs and MCP servers are kept).
 *
 * Every mode crawls the site; `routes` skips the API writers, which do most
 * of the AI work.
 */
export type CrawlJobMode = 'full' | 'api' | 'routes';

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
 * history is kept, and at most one row per origin is `pending` or `crawling`.
 */
export interface CrawlJob {
  id: string;
  origin: string;
  status: CrawlJobStatus;
  /** Crawl even though the site was crawled before. */
  force: boolean;
  /** What the job produces. */
  mode: CrawlJobMode;
  /**
   * Crawl in a visible (headed) Chrome window instead of headless Chromium:
   * gets past bot checks that block headless browsers. Default false.
   */
  headed_chrome: boolean;
  /** Higher runs first; ties run oldest first. */
  priority: number;
  attempts: number;
  /** Free text: who asked (`raidr-crawler`, `raidr-app`, a user id ...). */
  requested_by: string | null;
  /** Labels the requester already knows (e.g. the crawl list's category); seeds the site's labels. */
  labels: string[];
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
  /**
   * What the jobs produce. Default `full`. A job already queued for an origin
   * with another mode becomes `full`, so it produces both.
   */
  mode?: CrawlJobMode;
  /**
   * Crawl in headed Chrome (`CrawlJob.headed_chrome`). Default false. A job
   * already queued for an origin is switched on by a request that sets it.
   */
  headed_chrome?: boolean;
  priority?: number;
  requested_by?: string;
  /** Seed labels for every origin in this request (e.g. the list's category and section). */
  labels?: string[];
}

/**
 * Per-origin outcome of an enqueue:
 * - `queued`: a new job was created.
 * - `already-queued`: a job is `pending` or `crawling` already (`force` upgrades it).
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

/** Body of `PUT /crawl-jobs/:id`: change a pending job. */
export interface CrawlJobUpdateRequest {
  mode?: CrawlJobMode;
  priority?: number;
  headed_chrome?: boolean;
}

/** Body of `POST /crawl-jobs/:id/complete`. */
export interface CrawlJobCompleteRequest {
  worker: string;
  status: 'completed' | 'failed';
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
  /** Replaces the site's labels when present. */
  labels?: string[];
  /** ISO 8601 timestamp. */
  last_crawled_at?: string;
  /** Replaces the site's routes when present (`GET /sites/:origin/routes`). At most `MAX_SITE_ROUTES`. */
  routes?: SiteRoute[];
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

/** Query string for `GET /mcps`. */
export interface McpListQueryParams extends ListQueryParams {
  /** Comma-separated labels; a row matches when it has any of them. */
  label?: string;
}

/** One entry of `GET /labels`: a label and how many MCP servers carry it. */
export interface LabelCount {
  label: string;
  count: number;
}

/** Query string for `GET /crawl-jobs`. `q` matches the origin. */
export interface CrawlJobListQueryParams extends ListQueryParams {
  status?: CrawlJobStatus;
  mode?: CrawlJobMode;
}

/** Query string for `GET /sites`. */
export interface SiteListQueryParams extends ListQueryParams {
  /** Only sites that call this API host. */
  apiHost?: string;
  /** Comma-separated labels; a site matches when it has any of them. */
  label?: string;
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
