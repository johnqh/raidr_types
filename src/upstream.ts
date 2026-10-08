/**
 * Portable mapping from an MCP tool call to the upstream HTTP request, plus
 * the guards that keep a caller's token on the manifest's API host.
 *
 * Pure code with no `URL`, `URLSearchParams`, `Headers`, `Request`, DNS or
 * Node imports, so it runs the same in raidr_api, a browser and React Native
 * (whose built-in `URL` is incomplete). It mirrors raidr_api's
 * `src/mcp/upstream.ts` (`buildUpstreamRequest` / `applyAuth`) and the
 * literal-address checks of `src/mcp/guard.ts`. There is no DNS lookup here:
 * a device cannot resolve names before `fetch` does, so only literal IPs and
 * internal names are refused.
 */
import type { HttpMethod, McpAuth, McpManifest, McpTool } from './mcp.js';
import { extractPathParams, fillPathTemplate } from './paths.js';

/** Most bytes of an upstream response body a caller should keep (1 MB, raidr_api's default). */
export const MAX_UPSTREAM_BYTES = 1_000_000;

/**
 * The tool arguments cannot form a valid request (missing path param, path
 * off the API host). Its message is safe to show to the model.
 */
export class McpToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolInputError';
  }
}

/** Thrown by {@link assertSafeUpstream} when a request must not be sent. */
export class UpstreamBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamBlockedError';
  }
}

/** A plain description of one upstream request; hand it to any `fetch`. */
export interface UpstreamRequest {
  url: string;
  method: HttpMethod;
  /** Header names as given; at most one entry per name, compared case-insensitively. */
  headers: Record<string, string>;
  /** Present only when the request carries a body. */
  body?: string;
}

/** The parts of an absolute http(s) URL this module needs. */
export interface ParsedHttpUrl {
  protocol: 'http' | 'https';
  /** Lowercase hostname plus `:port` when the port is not the default. */
  host: string;
  /** Lowercase hostname; IPv6 keeps its brackets (`[::1]`). */
  hostname: string;
  port: string;
  /** Path without query or hash; `/` when empty. */
  path: string;
  /** Without the leading `?`; empty when there is none. */
  query: string;
  hash: string;
  hasCredentials: boolean;
}

const URL_RE = /^(https?):\/\/([^/?#\\]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i;

/**
 * Split an absolute http(s) URL without the `URL` class. Returns null for
 * anything else (other schemes, relative URLs, backslashes in the authority).
 */
export function parseHttpUrl(url: string): ParsedHttpUrl | null {
  const match = URL_RE.exec(url.trim());
  if (!match) return null;
  const protocol = match[1]!.toLowerCase() as 'http' | 'https';
  let authority = match[2]!;
  const hasCredentials = authority.includes('@');
  if (hasCredentials)
    authority = authority.slice(authority.lastIndexOf('@') + 1);
  authority = authority.toLowerCase();
  let hostname: string;
  let port = '';
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end < 0) return null;
    hostname = authority.slice(0, end + 1);
    const rest = authority.slice(end + 1);
    if (rest) {
      if (!/^:\d*$/.test(rest)) return null;
      port = rest.slice(1);
    }
  } else {
    const colon = authority.lastIndexOf(':');
    if (colon >= 0) {
      port = authority.slice(colon + 1);
      if (!/^\d*$/.test(port)) return null;
      hostname = authority.slice(0, colon);
    } else {
      hostname = authority;
    }
  }
  hostname = hostname.replace(/\.$/, '');
  if (!hostname) return null;
  if (
    (protocol === 'https' && port === '443') ||
    (protocol === 'http' && port === '80')
  )
    port = '';
  return {
    protocol,
    host: port ? `${hostname}:${port}` : hostname,
    hostname,
    port,
    path: match[3] || '/',
    query: match[4] ?? '',
    hash: match[5] ?? '',
    hasCredentials,
  };
}

/** Set a header, replacing any entry whose name differs only in case. */
function setHeader(
  headers: Record<string, string>,
  name: string,
  value: string
): void {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
  headers[name] = value;
}

/**
 * Place the caller's token per the manifest auth style, in place. No token,
 * or style `none`, sets nothing. Replaces any same-named header added
 * earlier; the fallbacks for a missing headerName/cookieName only matter for
 * manifests that skipped schema validation.
 */
export function applyAuth(
  headers: Record<string, string>,
  auth: McpAuth,
  token: string | undefined
): void {
  if (!token || auth.style === 'none') return;
  if (auth.style === 'bearer') {
    setHeader(
      headers,
      'Authorization',
      `${auth.tokenPrefix ?? 'Bearer '}${token}`
    );
  } else if (auth.style === 'header') {
    setHeader(
      headers,
      auth.headerName ?? 'Authorization',
      `${auth.tokenPrefix ?? ''}${token}`
    );
  } else if (auth.style === 'cookie') {
    setHeader(headers, 'Cookie', `${auth.cookieName ?? 'session'}=${token}`);
  }
}

/** Strings pass through; everything else is JSON-encoded (numbers, booleans, objects). */
function valueToString(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** `application/x-www-form-urlencoded` encoding, byte-for-byte what `URLSearchParams` produces. */
function formEncode(text: string): string {
  return encodeURIComponent(text)
    .replace(
      /[!'()~]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    )
    .replace(/%20/g, '+');
}

function encodePairs(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `${formEncode(k)}=${formEncode(v)}`).join('&');
}

/**
 * Map one tool call onto a plain request description, with no I/O.
 *
 * Same order and rules as raidr_api: path (placeholders filled with
 * `encodeURIComponent`) → URL on `baseUrl` (refused unless it stays on
 * `apiHost`) → query → static headers (manifest, then tool) → mapped headers
 * → body → auth last. A body is sent for non-GET methods when `request.body`
 * is set, or when `bodyFields` is non-empty (then as JSON unless `body` is
 * `form`). Default body fields are all arguments not consumed by path, query
 * or headers. With `bodyArg`, that one argument is the whole body.
 *
 * @throws McpToolInputError when a path param is missing or the URL leaves `apiHost`.
 */
export function buildUpstreamRequest(
  manifest: McpManifest,
  tool: McpTool,
  args: Record<string, unknown>,
  token: string | undefined
): UpstreamRequest {
  const { request } = tool;
  const pathParams = extractPathParams(request.pathTemplate);
  let path: string;
  try {
    path = fillPathTemplate(request.pathTemplate, args);
  } catch (error) {
    throw new McpToolInputError(
      error instanceof Error ? error.message : String(error)
    );
  }
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('://') ||
    path.includes('\\')
  ) {
    throw new McpToolInputError(
      `Path "${path}" is not a path on ${manifest.apiHost}`
    );
  }
  const base = parseHttpUrl(manifest.baseUrl);
  if (!base || base.hasCredentials || base.query || base.hash) {
    throw new McpToolInputError(
      `Manifest baseUrl ${manifest.baseUrl} is not a plain http(s) URL`
    );
  }
  if (base.host !== manifest.apiHost.toLowerCase()) {
    throw new McpToolInputError(
      `Resolved URL ${base.protocol}://${base.host} is not on ${manifest.apiHost}`
    );
  }
  const hashAt = path.indexOf('#');
  if (hashAt >= 0) path = path.slice(0, hashAt);
  const queryAt = path.indexOf('?');
  const templateQuery = queryAt >= 0 ? path.slice(queryAt + 1) : '';
  if (queryAt >= 0) path = path.slice(0, queryAt);
  const basePath = base.path.replace(/\/+$/, '');
  const used = new Set<string>(pathParams);

  const pairs: Array<[string, string]> = [];
  for (const [field, param] of Object.entries(request.query ?? {})) {
    used.add(field);
    const value = args[field];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) pairs.push([param, valueToString(item)]);
    } else {
      for (let i = pairs.length - 1; i >= 0; i--)
        if (pairs[i]![0] === param) pairs.splice(i, 1);
      pairs.push([param, valueToString(value)]);
    }
  }
  const query = [templateQuery, encodePairs(pairs)].filter(Boolean).join('&');
  const url = `${base.protocol}://${base.host}${basePath}${path}${query ? `?${query}` : ''}`;

  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
  };
  for (const [name, value] of Object.entries({
    ...manifest.staticHeaders,
    ...request.staticHeaders,
  })) {
    setHeader(headers, name, value);
  }
  for (const [field, headerName] of Object.entries(request.headers ?? {})) {
    used.add(field);
    const value = args[field];
    if (value !== undefined && value !== null)
      setHeader(headers, headerName, valueToString(value));
  }

  let body: string | undefined;
  const encode = (payload: unknown, asForm: boolean) => {
    if (asForm) {
      body = encodePairs(
        Object.entries(payload as Record<string, unknown>).map(([k, v]) => [
          k,
          valueToString(v),
        ])
      );
      setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
    } else {
      body = JSON.stringify(payload);
      setHeader(headers, 'Content-Type', 'application/json');
    }
  };
  const wantsBody =
    request.method !== 'GET' &&
    request.body !== null &&
    request.body !== undefined;
  if (request.method !== 'GET' && request.bodyArg) {
    const value = args[request.bodyArg];
    if (value !== undefined) {
      encode(
        value,
        request.body === 'form' && !!value && typeof value === 'object'
      );
    }
  } else if (
    wantsBody ||
    (request.method !== 'GET' &&
      request.bodyFields &&
      request.bodyFields.length > 0)
  ) {
    const bodyFields =
      request.bodyFields ?? Object.keys(args).filter((k) => !used.has(k));
    const payload: Record<string, unknown> = {};
    for (const field of bodyFields) {
      if (args[field] !== undefined) payload[field] = args[field];
    }
    encode(payload, request.body === 'form');
  }

  applyAuth(headers, manifest.auth, token);

  return {
    url,
    method: request.method,
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}

const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** IPv4 CIDRs refused: `[network, prefix length]` (same list as raidr_api's guard). */
const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToInt(ip: string): number {
  return (
    ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
  );
}

/**
 * Loopback, private, link-local, CGNAT, multicast and reserved addresses.
 * Accepts a bare address or a bracketed IPv6 one; a hostname returns false.
 */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (IPV4_RE.test(bare)) {
    const value = ipv4ToInt(bare);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (bare.includes(':') && /^[0-9a-f:.]+$/.test(bare)) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      bare === '::' ||
      bare === '::1' ||
      /^0*:0*:0*:0*:0*:0*:0*:0*1?$/.test(bare) ||
      bare.startsWith('::ffff:') ||
      bare.startsWith('fc') ||
      bare.startsWith('fd') ||
      bare.startsWith('fe8') ||
      bare.startsWith('fe9') ||
      bare.startsWith('fea') ||
      bare.startsWith('feb') ||
      bare.startsWith('ff')
    );
  }
  return false;
}

/** Names that only resolve inside a private network. */
const INTERNAL_NAME_RE =
  /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/i;

/**
 * A numeric host that is not a dotted quad (`2130706433`, `0x7f.1`, `127.1`):
 * WHATWG URL parsers turn these into IPv4 addresses, so they are refused.
 */
const NUMERIC_HOST_RE = /^(0x[0-9a-f]*|\d+)(\.(0x[0-9a-f]*|\d+)){0,3}\.?$/i;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface SafeUpstreamOptions {
  /**
   * Development only: allow `http://` and loopback for `localhost`,
   * `127.0.0.1` and `[::1]`. Never set in a release build.
   */
  allowLocalhost?: boolean;
}

/**
 * Refuse a request URL before any token is sent with it. It must be
 * `https://` (plain http only for loopback with `allowLocalhost`), carry no
 * credentials, and its host must equal the host of the manifest `baseUrl`
 * (and `apiHost`). Literal private, loopback and link-local addresses,
 * ambiguous numeric hosts and internal names are refused. No DNS is done.
 *
 * @throws UpstreamBlockedError
 */
export function assertSafeUpstream(
  url: string,
  manifest: Pick<McpManifest, 'apiHost' | 'baseUrl'>,
  options: SafeUpstreamOptions = {}
): void {
  const target = parseHttpUrl(url);
  if (!target) throw new UpstreamBlockedError(`${url} is not an http(s) URL`);
  if (target.hasCredentials)
    throw new UpstreamBlockedError('URLs with credentials are refused');
  const base = parseHttpUrl(manifest.baseUrl);
  if (!base || target.host !== base.host || target.protocol !== base.protocol)
    throw new UpstreamBlockedError(
      `${target.host} is not the manifest's host (${base?.host ?? manifest.baseUrl})`
    );
  if (target.host !== manifest.apiHost.toLowerCase())
    throw new UpstreamBlockedError(`${target.host} is not ${manifest.apiHost}`);
  const devLoopback =
    options.allowLocalhost === true && LOOPBACK_HOSTS.has(target.hostname);
  if (devLoopback) return;
  if (target.protocol !== 'https')
    throw new UpstreamBlockedError(`${target.host} must use https`);
  const bare = target.hostname.replace(/^\[|\]$/g, '');
  if (INTERNAL_NAME_RE.test(bare))
    throw new UpstreamBlockedError(`${target.hostname} is an internal name`);
  if (isPrivateAddress(bare))
    throw new UpstreamBlockedError(`${target.hostname} is a private address`);
  if (!IPV4_RE.test(bare) && NUMERIC_HOST_RE.test(bare))
    throw new UpstreamBlockedError(
      `${target.hostname} is an ambiguous numeric host`
    );
}
