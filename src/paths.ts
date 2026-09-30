/**
 * Path-template helpers shared by the schema (which checks placeholders
 * against the input schema) and raidr_api (which fills them per tool call).
 */

/** `{name}` placeholder; names are identifier-like so they match input fields. */
const PARAM_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Names of the `{param}` placeholders in a path template, in order, without duplicates. */
export function extractPathParams(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of template.matchAll(PARAM_RE)) {
    const name = match[1];
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Substitute `{param}` placeholders with URL-encoded values; throws when one is
 * missing (undefined or null). Encoding with `encodeURIComponent` keeps a value
 * inside its segment: it cannot add `/`, `?` or `#`.
 */
export function fillPathTemplate(
  template: string,
  values: Record<string, unknown>
): string {
  return template.replace(PARAM_RE, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter "${name}"`);
    }
    return encodeURIComponent(String(value));
  });
}

/**
 * Build the hosted MCP URL for an API host. Trailing slashes on `apiBaseUrl`
 * are dropped and `apiHost` is URL-encoded (a port's `:` becomes `%3A`).
 */
export function mcpProxyUrl(apiBaseUrl: string, apiHost: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/mcp/${encodeURIComponent(apiHost)}`;
}

/**
 * Resolve a filled path against a manifest baseUrl by concatenation, keeping
 * any base path (`https://h/v1` + `/users` → `https://h/v1/users`). Throws
 * unless the result stays on `apiHost`, so a malformed manifest can never
 * route a caller's token to another host.
 */
export function resolveUpstreamUrl(
  baseUrl: string,
  path: string,
  apiHost: string
): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    throw new Error(`Path "${path}" is not a path on ${apiHost}`);
  }
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${base.origin}${basePath}${path}`);
  if (url.host !== apiHost || url.origin !== base.origin) {
    throw new Error(`Resolved URL ${url.origin} is not on ${apiHost}`);
  }
  return url;
}
