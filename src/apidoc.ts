/**
 * API documentation: every endpoint raidr found for one API host and the
 * kind of credential it needs. One `ApiDoc` per API host, next to its MCP
 * manifest and skill. raidr_app renders it as a "try it" playground and runs
 * requests through raidr_api's execute proxy.
 *
 * Version 1 describes an endpoint with flat form parameters. Version 2
 * describes its whole request (path, query, headers, body) and every
 * response it handles as JSON Schemas read from the site's code; raidr_api
 * stores version-2 endpoints as rows of their own.
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

// =============================================================================
// Schemas (doc version 2)
// =============================================================================

/**
 * @description The JSON Schema subset raidr uses for request and response
 * structures, the same subset ShapeShyft stores for its endpoints. Every
 * property raidr writes carries a `description`. Two raidr keywords ride
 * along: `x-raidr-header` on a header property, `x-raidr-evidence` anywhere.
 */
export interface ApiJsonSchema {
  /** JSON type, or several (e.g. `['string', 'null']` for a nullable string). */
  type?: ApiJsonSchemaType | ApiJsonSchemaType[];
  /** What the value is and how the site uses it. */
  description?: string;
  /** Fields of an object, by name. */
  properties?: Record<string, ApiJsonSchema>;
  /** Names of the fields that are always present (or must be sent). */
  required?: string[];
  /** Shape of every array element. */
  items?: ApiJsonSchema;
  /** False when no other fields are allowed; a schema for the extra fields' values. */
  additionalProperties?: boolean | ApiJsonSchema;
  /** The value is exactly one of these. */
  enum?: (string | number | boolean | null)[];
  /** The value matches one of these shapes (a tagged union in the site's code). */
  anyOf?: ApiJsonSchema[];
  /** Value used when the site omits it. */
  default?: unknown;
  /** Realistic values, personal data redacted. */
  examples?: unknown[];
  /** e.g. `uuid`, `email`, `uri`, `date`, `date-time`. */
  format?: string;
  /** Regular expression (ECMAScript, no slashes) a string matches. */
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  /** Where a header's value comes from; only on properties of `input.properties.headers`. */
  'x-raidr-header'?: HeaderSource;
  /** What the property is known from. */
  'x-raidr-evidence'?: SchemaEvidence;
}

/** A JSON Schema primitive type name. */
export type ApiJsonSchemaType =
  'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null';

/**
 * @description What a schema property is known from:
 * - `code`: read in the site's JavaScript only.
 * - `traffic`: seen in recorded requests or responses only.
 * - `both`: read in the code and seen in traffic.
 */
export type SchemaEvidence = 'code' | 'traffic' | 'both';

/**
 * @description Where a request header's value comes from:
 * - `constant`: a fixed value (`x-app-version: 3.2.1`).
 * - `cookie`: copied from a cookie.
 * - `storage`: copied from localStorage or sessionStorage.
 * - `response`: copied from a field of an earlier response.
 * - `auth`: the user's token or the API key (see `ApiDoc.auth`).
 * - `computed`: worked out by the site's code; see `recipe`.
 * - `unknown`: seen in traffic, but where its value comes from was not found.
 */
export type HeaderSourceKind =
  | 'constant'
  | 'cookie'
  | 'storage'
  | 'response'
  | 'auth'
  | 'computed'
  | 'unknown';

/** @description Where one request header's value comes from, so a caller can send it. */
export interface HeaderSource {
  /** Kind of source; decides which other fields are set. */
  kind: HeaderSourceKind;
  /** The fixed value, for `constant`. */
  value?: string;
  /** Cookie name or storage key, for `cookie` and `storage`. */
  key?: string;
  /** The endpoint and response field it is copied from, for `response`. */
  from?: { endpointId: string; field: string };
  /** How to compute the value, for `computed`. */
  recipe?: HeaderRecipe;
}

/**
 * @description How the site's code computes a header value, precise enough
 * for an MCP tool to reproduce it (e.g. a request signature).
 */
export interface HeaderRecipe {
  /** One line, e.g. `HMAC-SHA256 of method + path + timestamp`. */
  summary: string;
  /** Ordered steps, each one plain sentence. */
  steps: string[];
  /** Values the steps read: other headers, the body, the clock, a key. */
  inputs: string[];
  /** Where the code was found, for review. */
  codeRef?: { script: string; line?: number };
}

/** How a request body is encoded. */
export type BodyEncoding = 'json' | 'form' | 'multipart' | 'text';

/**
 * @description Everything a caller sends, grouped by where it goes so names
 * never clash and a body can be any JSON shape. A group is absent when the
 * endpoint takes nothing there.
 */
export interface EndpointInputSchema extends ApiJsonSchema {
  type: 'object';
  properties: {
    /** `{name}` placeholders in the path; every one is listed in `required`. */
    path?: ApiJsonSchema;
    /** Query-string parameters. */
    query?: ApiJsonSchema;
    /** Headers the site sends on purpose; each property carries `x-raidr-header`. */
    headers?: ApiJsonSchema;
    /** The request body; its encoding is `ApiEndpointV2.bodyEncoding`. */
    body?: ApiJsonSchema;
  };
}

/** @description One response status the site's code handles. */
export interface EndpointResponse {
  /** HTTP status, e.g. 200. */
  status: number;
  /** When the site gets it and what it means. */
  description: string;
  /** e.g. `application/json`. */
  contentType?: string;
  /** Shape of the body; absent for an empty or non-JSON body. */
  schema?: ApiJsonSchema;
  /** A short example body, personal data redacted. */
  example?: string;
}

// =============================================================================
// Endpoints
// =============================================================================

/** Fields every endpoint has, in both doc versions. */
export interface ApiEndpointBase {
  /** `METHOD path`, unique within the doc, e.g. `GET /api/clip/{clip_id}`. */
  id: string;
  method: HttpMethod;
  /** Relative to `ApiDoc.baseUrl`, with `{param}` placeholders. */
  path: string;
  /** One line: what it does. */
  summary: string;
  description?: string;
  auth: EndpointAuth;
  /** Grouping label, usually the first meaningful path word. */
  tag?: string;
  /** `login`: signs a user in and returns the token other endpoints need. */
  role?: 'login';
}

/**
 * @description An endpoint in a version-2 doc: its request and responses as
 * JSON Schemas read from the site's code and checked against traffic.
 */
export interface ApiEndpointV2 extends ApiEndpointBase {
  /** Body encoding; absent or null means no body. */
  bodyEncoding?: BodyEncoding | null;
  /** Path, query, headers and body. */
  input: EndpointInputSchema;
  /** One per status the code handles, success first. */
  responses: EndpointResponse[];
}

/** An endpoint in a version-1 doc: flat form parameters. */
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

/** Doc-level fields, the same in both versions. */
interface ApiDocBase {
  /** Primary key; equals the host of `baseUrl`. */
  apiHost: string;
  baseUrl: string;
  siteOrigins: string[];
  title: string;
  description: string;
  auth: { user?: ApiUserAuth; apiKey?: ApiKeyAuth };
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

/** A version-1 doc: flat parameters, top-level response fields. */
export interface ApiDocV1 extends ApiDocBase {
  schemaVersion: 1;
  endpoints: ApiEndpoint[];
}

/** @description A version-2 doc: request and response schemas for every endpoint. */
export interface ApiDocV2 extends ApiDocBase {
  schemaVersion: 2;
  endpoints: ApiEndpointV2[];
  /** The agent that wrote the schemas' descriptions; `none` when only code and traffic were used. */
  extractedBy?: 'claude' | 'codex' | 'none';
}

/** Everything known about one API host's endpoints, in either version. */
export type ApiDoc = ApiDocV1 | ApiDocV2;

/** An endpoint of either doc version. */
export type AnyApiEndpoint = ApiEndpoint | ApiEndpointV2;

/** True for a version-2 doc. */
export function isApiDocV2(doc: ApiDoc): doc is ApiDocV2 {
  return doc.schemaVersion === 2;
}

/** True for a version-2 endpoint. */
export function isApiEndpointV2(
  endpoint: AnyApiEndpoint
): endpoint is ApiEndpointV2 {
  return 'input' in endpoint;
}

/** Endpoint reference used in links: `METHOD https://host/path/{param}`. */
export function endpointRef(
  baseUrl: string,
  endpoint: Pick<ApiEndpointBase, 'method' | 'path'>
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
