/**
 * Crawl records and the security issues an optional audit found in them.
 *
 * A crawl record is one finished crawl of a site (`crawls` table), unique on
 * origin + crawl time. An audit is opt-in per crawl job; it is passive (it
 * reads only what the crawl recorded) and its issues belong to one crawl.
 */

/** What kind of weakness an issue is. */
export type SecurityCategory =
  'secrets' | 'client-code' | 'headers-cookies' | 'api-exposure';

export const SECURITY_CATEGORIES: readonly SecurityCategory[] = [
  'secrets',
  'client-code',
  'headers-cookies',
  'api-exposure',
];

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Most severe first. */
export const SECURITY_SEVERITIES: readonly SecuritySeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

/** How sure the audit is that the issue is real. */
export type SecurityConfidence = 'high' | 'medium' | 'low';

/**
 * Where an issue was seen. Secret values are masked before they are stored
 * (`sk_live_ab…yz`); `snippet` is at most `MAX_EVIDENCE_SNIPPET` characters.
 * - `code`: a JavaScript file the site shipped (`file`, `line`, `snippet`).
 * - `traffic`: a recorded request (`endpoint` = `METHOD /path`, `url`).
 * - `header`: a response header (`header`, `url`).
 * - `cookie`: a cookie's attributes (`cookie`; never its value).
 */
export interface SecurityEvidence {
  kind: 'code' | 'traffic' | 'header' | 'cookie';
  file?: string;
  line?: number;
  snippet?: string;
  url?: string;
  endpoint?: string;
  header?: string;
  cookie?: string;
}

export const MAX_EVIDENCE_SNIPPET = 500;

/** An issue as the crawler reports it (body of `POST /crawls`). */
export interface SecurityIssueInput {
  /** The check that raised it, e.g. `secret-in-code`, `cors-any-origin`. */
  rule: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  confidence: SecurityConfidence;
  title: string;
  description: string;
  /** How to fix it. */
  recommendation: string;
  /** e.g. `CWE-798`. */
  cwe: string | null;
  /** OWASP Top 10 (2021) entry, e.g. `A07:2021`. */
  owasp: string | null;
  /** The API host it concerns, when it concerns one. */
  api_host: string | null;
  evidence: SecurityEvidence[];
  /**
   * Stable across crawls of the same site: the same weakness found again
   * gets the same fingerprint, so issues can be followed over time.
   */
  fingerprint: string;
}

/** Row of the `security_issues` table. */
export interface SecurityIssue extends SecurityIssueInput {
  id: string;
  crawl_id: string;
  origin: string;
  created_at: Date | null;
}

/** An issue from `GET /security-issues`: with its crawl's time and the site's newest crawl time. */
export interface LatestSecurityIssue extends SecurityIssue {
  crawled_at: Date;
  /** The site's newest crawl, audited or not; later than `crawled_at` when the audit is stale. */
  latest_crawled_at: Date;
}

export type SecurityIssueCounts = Record<SecuritySeverity, number>;

/**
 * Row of the `crawls` table: one finished crawl of a site.
 * - `audited`: the audit ran and its issues are stored (possibly none).
 * - `audit_error`: the audit was asked for and failed; `audited` stays false.
 */
export interface CrawlRecord {
  id: string;
  origin: string;
  crawled_at: Date;
  /** The crawl job that produced it, when it came from the queue. */
  job_id: string | null;
  audited: boolean;
  audited_at: Date | null;
  audit_error: string | null;
  issue_counts: SecurityIssueCounts;
  created_at: Date | null;
  updated_at: Date | null;
}

/** The audit part of `POST /crawls`. */
export interface CrawlAuditInput {
  issues: SecurityIssueInput[];
  /** Set when the audit failed; `issues` is then ignored. */
  error?: string;
}

/**
 * Body of `POST /crawls`: record a crawl, upserting on origin + `crawled_at`.
 * With `audit`, the crawl's issues are replaced by `audit.issues`.
 */
export interface CrawlRecordRequest {
  origin: string;
  /** ISO 8601: when the site was crawled (the bundle's start time). */
  crawled_at: string;
  job_id?: string;
  audit?: CrawlAuditInput;
}

/** At most this many issues per crawl. */
export const MAX_SECURITY_ISSUES = 500;

/** Query string for `GET /crawls`. */
export interface CrawlListQueryParams {
  origin?: string;
  audited?: boolean;
  /** Default 50, maximum 200. */
  limit?: number;
  offset?: number;
}

/**
 * Query string for `GET /security-issues` (each site's newest audited crawl)
 * and `GET /crawls/:id/security-issues`. `severity` and `category` are
 * comma-separated lists; an issue matches any of the values.
 */
export interface SecurityIssueListQueryParams {
  origin?: string;
  severity?: string;
  category?: string;
  /** Default 50, maximum 200. */
  limit?: number;
  offset?: number;
}
