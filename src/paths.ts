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

/** Substitute `{param}` placeholders with URL-encoded values; throws when one is missing. */
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

/** Build the hosted MCP URL for an API host. */
export function mcpProxyUrl(apiBaseUrl: string, apiHost: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/mcp/${encodeURIComponent(apiHost)}`;
}
