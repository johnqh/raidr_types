/**
 * Reading a signed-in user's credential off a request the site itself sent,
 * and the message protocol between raidr.app and the raidr browser extension.
 *
 * The extension and the `raidr token` command (raidr_cli) both watch the site's
 * own traffic after the user signs in and use {@link extractCredential} to
 * pull the token out of it, in exactly the form raidr later sends back
 * upstream (`X-Raidr-Token`): the bearer token without `Bearer `, a header's
 * value without its prefix, or one cookie's value.
 */

/** How a site's token travels; the fields of `ApiUserAuth` and `McpAuth` that matter here. */
export interface CredentialAuth {
  style: 'bearer' | 'header' | 'cookie' | 'none';
  headerName?: string | undefined;
  cookieName?: string | undefined;
  tokenPrefix?: string | undefined;
}

/** A credential seen on a request, with what it was checked against. */
export interface CapturedCredential {
  token: string;
  /**
   * True when a request carrying it to a signed-in-only endpoint succeeded;
   * false when it is only the last credential seen before the window closed.
   */
  verified: boolean;
}

/** Redaction placeholders and obvious non-tokens are never a credential. */
const NOT_A_TOKEN = /^(null|undefined|anonymous|guest|<[A-Z_]+:[^>]*>)?$/i;

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted || value === undefined) continue;
    return Array.isArray(value) ? value.join('; ') : value;
  }
  return null;
}

/** One cookie's value out of a `Cookie` request header. */
export function cookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * The token a request carries for `auth`, or null. Header names match
 * case-insensitively; a header given as an array is joined.
 */
export function extractCredential(
  headers: Record<string, string | string[] | undefined>,
  auth: CredentialAuth
): string | null {
  let token: string | null = null;
  if (auth.style === 'bearer') {
    const value = header(headers, 'authorization');
    const prefix = auth.tokenPrefix ?? 'Bearer ';
    if (value && value.toLowerCase().startsWith(prefix.toLowerCase())) {
      token = value.slice(prefix.length).trim();
    }
  } else if (auth.style === 'header') {
    const value = auth.headerName ? header(headers, auth.headerName) : null;
    const prefix = auth.tokenPrefix ?? '';
    if (value && value.startsWith(prefix))
      token = value.slice(prefix.length).trim();
  } else if (auth.style === 'cookie') {
    const value = header(headers, 'cookie');
    token = value ? cookieValue(value, auth.cookieName ?? 'session') : null;
  }
  return token && !NOT_A_TOKEN.test(token) ? token : null;
}

/** True when `path` (no query) fits `template` (`/clips/{clip_id}`); a `{param}` matches one segment. */
export function matchesPathTemplate(template: string, path: string): boolean {
  const t = template.replace(/\/+$/, '').split('/');
  const p = path.split('?')[0]!.replace(/\/+$/, '').split('/');
  if (t.length !== p.length) return false;
  return t.every((segment, i) =>
    /^\{[^}]+\}$/.test(segment) ? (p[i] ?? '').length > 0 : segment === p[i]
  );
}

// --- raidr.app ⇄ extension bridge -------------------------------------------

/** `source` on messages the raidr app posts to its own window. */
export const RAIDR_BRIDGE_APP = 'raidr-app';
/** `source` on messages the extension's content script posts back. */
export const RAIDR_BRIDGE_EXTENSION = 'raidr-extension';

/** Ask the extension to sign the user in to a site and return its token. */
export interface TokenRequest {
  apiHost: string;
  /** The site's sign-in page (or its home page). */
  loginUrl: string;
  auth: CredentialAuth;
  /**
   * Path templates of this host's signed-in-only endpoints. A credential
   * counts as verified once one of them answers 2xx with it.
   */
  userPaths: string[];
}

/** App → extension, posted to `window` with `source: RAIDR_BRIDGE_APP`. */
export type BridgeRequest =
  | { source: typeof RAIDR_BRIDGE_APP; type: 'ping'; id: string }
  | {
      source: typeof RAIDR_BRIDGE_APP;
      type: 'token/request';
      id: string;
      request: TokenRequest;
    }
  | { source: typeof RAIDR_BRIDGE_APP; type: 'token/cancel'; id: string };

/** Extension → app, posted to `window` with `source: RAIDR_BRIDGE_EXTENSION`; `id` echoes the request. */
export type BridgeResponse =
  | {
      source: typeof RAIDR_BRIDGE_EXTENSION;
      type: 'pong';
      id: string;
      version: string;
    }
  | { source: typeof RAIDR_BRIDGE_EXTENSION; type: 'token/opened'; id: string }
  | {
      source: typeof RAIDR_BRIDGE_EXTENSION;
      type: 'token/result';
      id: string;
      credential: CapturedCredential;
    }
  | {
      source: typeof RAIDR_BRIDGE_EXTENSION;
      type: 'token/failed';
      id: string;
      /** `closed`: the window closed with no credential seen. */
      reason: 'closed' | 'blocked' | 'error';
      message?: string;
    };

export function isBridgeResponse(value: unknown): value is BridgeResponse {
  const v = value as { source?: unknown; type?: unknown; id?: unknown } | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    v.source === RAIDR_BRIDGE_EXTENSION &&
    typeof v.type === 'string' &&
    typeof v.id === 'string'
  );
}

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  const v = value as { source?: unknown; type?: unknown; id?: unknown } | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    v.source === RAIDR_BRIDGE_APP &&
    typeof v.type === 'string' &&
    typeof v.id === 'string'
  );
}
