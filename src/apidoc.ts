/**
 * API documentation: every endpoint raidr found for one API host, with its
 * parameters typed for a form UI (text, number, enum, boolean, JSON) and the
 * kind of credential it needs. One `ApiDoc` per API host, next to its MCP
 * manifest and skill. raidr_app renders it as a "try it" playground and runs
 * requests through raidr_api's execute proxy.
 */
import type { HttpMethod, McpSource } from './mcp.js';

/**
 * What an endpoint needs to answer:
 * - `none`: nothing; anyone can call it.
 * - `user`: a signed-in user's token (session cookie or bearer token).
 * - `api_key`: an application key (header or query parameter).
 */
export type EndpointAuth = 'none' | 'user' | 'api_key';

/** Where a parameter goes in the request. */
export type ApiParamLocation = 'path' | 'query' | 'header' | 'body';

/**
 * Parameter type; decides the input control. `enum` is a Select; `object`
 * and `array` of objects are JSON text; `boolean` is a switch.
 */
export type ApiParamType =
  'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'object' | 'array';

/** Value formats that get their own validation. */
export type ApiParamFormat = 'uuid' | 'email' | 'uri' | 'date' | 'date-time';

export interface ApiParam {
  /** Form field name; unique within the endpoint. For `body`, also the JSON key. */
  name: string;
  in: ApiParamLocation;
  type: ApiParamType;
  required: boolean;
  description?: string;
  /** Allowed values when `type` is `enum`. */
  enum?: string[];
  /**
   * False when the values are only those seen in use, not a known closed set;
   * a UI then also allows typing another value.
   */
  enumExhaustive?: boolean;
  /** Element type when `type` is `array`. */
  itemType?: 'string' | 'integer' | 'number' | 'boolean' | 'object';
  format?: ApiParamFormat;
  /** Regular expression (ECMAScript, no slashes) a string value must match. */
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  /** A realistic value, shown as the placeholder. */
  example?: unknown;
  /** Name on the wire when it differs from `name` (query key or header name). */
  wireName?: string;
}

/** One documented response. */
export interface ApiResponseDoc {
  status: number;
  description?: string;
  contentType?: string;
  /** Top-level field names of a JSON body. */
  fields?: string[];
  /** A short example body (truncated text). */
  example?: string;
}

export interface ApiEndpoint {
  /** `METHOD path`, unique within the doc, e.g. `GET /api/clip/{clip_id}`. */
  id: string;
  method: HttpMethod;
  /** Relative to `ApiDoc.baseUrl`, with `{param}` placeholders. */
  path: string;
  /** One line: what it does. */
  summary: string;
  description?: string;
  auth: EndpointAuth;
  params: ApiParam[];
  /** Body encoding for non-GET requests; absent or null means no body. */
  body?: 'json' | 'form' | null;
  /** The body takes fields beyond `params`; a UI offers a raw JSON editor. */
  additionalBody?: boolean;
  responses: ApiResponseDoc[];
  /** Grouping label, usually the first meaningful path word. */
  tag?: string;
  /** `login`: signs a user in and returns the token other endpoints need. */
  role?: 'login';
}

/** One endpoint anywhere in the catalog. */
export interface EndpointNodeRef {
  apiHost: string;
  /** `ApiEndpoint.id`, `METHOD path`. */
  endpointId: string;
}

/**
 * - `auth`: the producer returns the credential the consumer is called with.
 * - `data`: the producer returns a value (an id, a cursor) the consumer takes.
 */
export type EndpointLinkKind = 'auth' | 'data';

/**
 * - `observed`: the value was seen leaving one response and entering a later
 *   request.
 * - `inferred`: deduced from the API's shape (a `{clip_id}` parameter and a
 *   clip list endpoint), not seen in use.
 */
export type EndpointLinkEvidence = 'observed' | 'inferred';

/**
 * A step in a flow: data from `from`'s response is needed to call `to`
 * ("Browse products" → "Product details"). `from` may be on another API host.
 */
export interface EndpointLink {
  from: EndpointNodeRef;
  to: EndpointNodeRef;
  kind: EndpointLinkKind;
  evidence: EndpointLinkEvidence;
  /** Response field the value comes from, e.g. `items[].id` or `access_token`. */
  fromField?: string;
  /** Parameter it fills, e.g. `clip_id`, or `Authorization`. */
  toParam?: string;
  /** How often it was observed. */
  count?: number;
}

/** Label for an endpoint on another API host, for flow maps. */
export interface ExternalEndpointLabel extends EndpointNodeRef {
  method: HttpMethod;
  path: string;
  summary: string | null;
}

/** `GET /apis/:apiHost/flow`: every link touching this host, plus labels for the others. */
export interface ApiFlow {
  apiHost: string;
  /** Links whose `from` or `to` is on this host. */
  links: EndpointLink[];
  /** Endpoints on other hosts that appear in `links`. */
  external: ExternalEndpointLabel[];
}

/** How a signed-in user's token is sent. */
export interface ApiUserAuth {
  style: 'bearer' | 'header' | 'cookie';
  headerName?: string;
  cookieName?: string;
  /** Text before the token; defaults to `Bearer ` for bearer. */
  tokenPrefix?: string;
  /** Where the user signs in to get a token (the site). */
  loginUrl?: string;
  /** Where to copy the token from after signing in, in plain words. */
  tokenHint?: string;
}

/** How an application key is sent. */
export interface ApiKeyAuth {
  in: 'header' | 'query';
  name: string;
  /** Where to find the key, in plain words. */
  hint?: string;
}

/** Everything known about one API host's endpoints. */
export interface ApiDoc {
  schemaVersion: 1;
  /** Primary key; equals the host of `baseUrl`. */
  apiHost: string;
  baseUrl: string;
  siteOrigins: string[];
  title: string;
  description: string;
  auth: { user?: ApiUserAuth; apiKey?: ApiKeyAuth };
  endpoints: ApiEndpoint[];
  /**
   * Links that end at this host's endpoints (`to.apiHost === apiHost`); `from`
   * may be any host. raidr_api stores them in its links table so flows can
   * be read from either end.
   */
  links?: EndpointLink[];
  version: string;
  generatedAt: string;
  source: McpSource;
}

/** Endpoint reference used in links: `METHOD https://host/path/{param}`. */
export function endpointRef(
  baseUrl: string,
  endpoint: Pick<ApiEndpoint, 'method' | 'path'>
): string {
  return `${endpoint.method} ${baseUrl.replace(/\/+$/, '')}${endpoint.path}`;
}

/**
 * Parse an `endpointRef`. Returns the API host (with port), the method and
 * the path template, or null when the text is not a valid reference.
 */
export function parseEndpointRef(ref: string): {
  method: HttpMethod;
  apiHost: string;
  origin: string;
  path: string;
} | null {
  const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/[^/\s]+)(\/\S*)?$/.exec(
    ref.trim()
  );
  if (!m) return null;
  try {
    const url = new URL(m[2]!);
    return {
      method: m[1] as HttpMethod,
      apiHost: url.host,
      origin: url.origin,
      path: m[3] ?? '/',
    };
  } catch {
    return null;
  }
}
