/**
 * Wire constants shared by raidr_api and its clients. Changing one is a
 * breaking change for every deployed MCP client configuration.
 */

/** Header an MCP client sends so the hosted server can forward the user's site token. */
export const RAIDR_TOKEN_HEADER = 'X-Raidr-Token';

/**
 * Header carrying a key for raidr_api: the catalog admin write key, or an
 * entity API key (`raidr_...`). Entity keys may also travel as
 * `Authorization: Bearer raidr_...`, which is what MCP client snippets use.
 */
export const RAIDR_API_KEY_HEADER = 'X-API-Key';

/**
 * Prefix of entity API keys: keys look like `raidr_<hex>`. entity_service
 * requires 1-12 lowercase alphanumerics; the `_` separator is added on
 * generation. Changing it invalidates every issued key's format check.
 */
export const RAIDR_ENTITY_KEY_PREFIX = 'raidr';

/**
 * Local settings file where a skill stores the user's raidr API key, so the
 * key is asked for once. JSON shaped as {@link RaidrSettings}; keep it mode 600.
 */
export const RAIDR_SETTINGS_FILE = '~/.raidr/config.json';

/** Path prefix of the hosted MCP endpoint: `${apiBaseUrl}/mcp/${apiHost}`. */
export const MCP_PROXY_PATH = '/mcp';

/**
 * Allowed shape of an MCP tool name: snake_case, 2-64 chars, letter first.
 * Enforced by `mcpToolSchema`.
 */
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** Current manifest schema version; `McpManifest.schemaVersion` must equal it. */
export const MCP_SCHEMA_VERSION = 1 as const;

/** Contents of {@link RAIDR_SETTINGS_FILE}. */
export interface RaidrSettings {
  /** Entity API key (`raidr_...`) created at raidr.app under Dashboard > API keys. */
  apiKey?: string;
  /** raidr_api base URL override; defaults to https://api.raidr.app. */
  apiUrl?: string;
  /**
   * Site tokens by API host, written by `raidr token <apiHost>` (raidr_cli) after
   * the user signs in to the site in a local browser.
   */
  siteTokens?: Record<string, { token: string; savedAt: string }>;
}

/** A running crawl job whose lease expires is retried until this many attempts. */
export const CRAWL_JOB_MAX_ATTEMPTS = 3;
/** Default crawl job lease, in seconds. */
export const CRAWL_JOB_LEASE_SECONDS = 1800;

/** A label: a lowercase slug such as `recipes` or `real-estate`. */
export const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Most labels one site or MCP server carries. */
export const MAX_LABELS = 12;

/** Most routes one site stores. */
export const MAX_SITE_ROUTES = 500;

/**
 * Text as a label: `"Banks - United States"` → `banks-united-states`. Returns
 * null when nothing usable is left.
 */
export function toLabel(text: string): string | null {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Too long: cut at the last whole word that fits.
  const cut =
    slug.length > 40 ? slug.slice(0, 41).replace(/-[^-]*$/, '') : slug;
  return LABEL_RE.test(cut) ? cut : null;
}

/** Labels merged in order, deduplicated, invalid ones dropped, capped at `MAX_LABELS`. */
export function mergeLabels(
  ...lists: Array<readonly string[] | undefined>
): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const label = LABEL_RE.test(raw) ? raw : toLabel(raw);
      if (label && !out.includes(label)) out.push(label);
      if (out.length === MAX_LABELS) return out;
    }
  }
  return out;
}
