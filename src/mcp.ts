/**
 * MCP manifest: the declarative description of one API host that the hosted
 * raidr MCP server turns into tools. One manifest per API host.
 */

/** A loose JSON Schema (draft 7 or 2020-12) value. */
export type JsonSchema = Record<string, unknown>;

/** A JSON Schema whose root is an object; MCP tool inputs must be this shape. */
export interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  [key: string]: unknown;
}

/**
 * How the user's token reaches the upstream API.
 * - `bearer`: `Authorization: <tokenPrefix><token>` (prefix defaults to `Bearer `)
 * - `header`: `<headerName>: <tokenPrefix><token>`
 * - `cookie`: `Cookie: <cookieName>=<token>`
 * - `none`: the API needs no credential
 */
export type McpAuthStyle = 'bearer' | 'header' | 'cookie' | 'none';

/**
 * Credential placement for one API host. raidr stores no credentials: the
 * caller supplies a token per MCP connection and raidr_api's `applyAuth`
 * places it as described here. The zod schema requires `headerName` for
 * `header` and `cookieName` for `cookie`.
 */
export interface McpAuth {
  style: McpAuthStyle;
  /** Required when style is `header`. */
  headerName?: string;
  /** Required when style is `cookie`. */
  cookieName?: string;
  /**
   * Text placed before the token; defaults to `Bearer ` for bearer and empty
   * for header. Ignored for cookie.
   */
  tokenPrefix?: string;
}

/** Methods a tool may use upstream. GET never carries a body. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Maps a tool's input fields onto one HTTP request. Every field named here
 * (path placeholder, query key, header key, body field) must exist in the
 * tool's `inputSchema.properties`; `mcpToolSchema` enforces that.
 */
export interface McpToolRequest {
  method: HttpMethod;
  /**
   * Path relative to the manifest `baseUrl`, with `{param}` placeholders.
   * Must start with `/` and must not start with `//`, contain `://` or contain
   * a backslash: any of those could move the request, and the caller's token,
   * off `apiHost`.
   */
  pathTemplate: string;
  /**
   * Input field name → query parameter name. raidr_api appends one parameter
   * per element for array values and skips undefined or null values.
   */
  query?: Record<string, string>;
  /**
   * Body encoding for non-GET requests; null or absent means no body.
   * Exception: raidr_api still sends a JSON body when this is absent but
   * `bodyFields` is non-empty.
   */
  body?: 'json' | 'form' | null;
  /** Input fields sent in the body. Defaults to every field not used by the path, query or headers. */
  bodyFields?: string[];
  /** Input field name → request header name. */
  headers?: Record<string, string>;
}

/** Optional description of what the upstream returns; informational only. */
export interface McpToolResponseHints {
  contentType?: string;
  description?: string;
  example?: unknown;
}

/** Where the tool came from in the capture, so a reviewer can check it. */
export interface McpToolEvidence {
  /** `METHOD /path/{template}` as produced by raidr_processor's endpointKey. */
  endpointKey: string;
  calls: number;
  /** Prettified chunk file that contains the call site, when one was found. */
  chunk?: string;
}

/** One MCP tool: a JSON Schema input plus the HTTP request it maps onto. */
export interface McpTool {
  /** Unique within the manifest; `^[a-z][a-z0-9_]{1,63}$`. */
  name: string;
  description: string;
  /** Served to MCP clients as-is; raidr_api does not convert it to zod. */
  inputSchema: JsonSchemaObject;
  request: McpToolRequest;
  responseHints?: McpToolResponseHints;
  evidence?: McpToolEvidence;
}

/** Provenance of a manifest: which capture bundle and crawler produced it. */
export interface McpSource {
  bundleName: string;
  crawlerVersion: string;
  /** Who or what turned the analysis into this manifest. */
  analyzedBy?: string;
  capturedAt?: string;
}

/**
 * The full description of one API host. Fields are camelCase because this is
 * a document stored whole in a JSONB column, not a database row.
 */
export interface McpManifest {
  /** Always `MCP_SCHEMA_VERSION`; the schema rejects anything else. */
  schemaVersion: 1;
  /**
   * Primary key, e.g. `api.example.com` (a port is allowed). The schema
   * requires it to equal the host of `baseUrl`.
   */
  apiHost: string;
  /**
   * Origin every `pathTemplate` is relative to, e.g. `https://api.example.com`.
   * May include a base path (`https://h/v1`); must be http(s) with no
   * credentials, query or hash.
   */
  baseUrl: string;
  /** Sites observed calling this API. */
  siteOrigins: string[];
  title: string;
  description: string;
  auth: McpAuth;
  /**
   * Non-secret headers every upstream call needs, e.g. a client version.
   * Anyone can read a manifest, so never put a credential here.
   */
  staticHeaders?: Record<string, string>;
  tools: McpTool[];
  /** Crawler-assigned; bumps when the content changes. */
  version: string;
  /** ISO 8601 timestamp. */
  generatedAt: string;
  source: McpSource;
}
