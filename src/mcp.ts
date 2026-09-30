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

export interface McpAuth {
  style: McpAuthStyle;
  /** Required when style is `header`. */
  headerName?: string;
  /** Required when style is `cookie`. */
  cookieName?: string;
  /** Text placed before the token; `Bearer ` for bearer, empty for header. */
  tokenPrefix?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Maps a tool's input fields onto one HTTP request. */
export interface McpToolRequest {
  method: HttpMethod;
  /** Path relative to the manifest `baseUrl`, with `{param}` placeholders. */
  pathTemplate: string;
  /** Input field name → query parameter name. */
  query?: Record<string, string>;
  /** Body encoding for non-GET requests; null or absent means no body. */
  body?: 'json' | 'form' | null;
  /** Input fields sent in the body. Defaults to every field not used by the path, query or headers. */
  bodyFields?: string[];
  /** Input field name → request header name. */
  headers?: Record<string, string>;
}

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

export interface McpTool {
  /** Unique within the manifest; `^[a-z][a-z0-9_]{1,63}$`. */
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  request: McpToolRequest;
  responseHints?: McpToolResponseHints;
  evidence?: McpToolEvidence;
}

export interface McpSource {
  bundleName: string;
  crawlerVersion: string;
  /** Who or what turned the analysis into this manifest. */
  analyzedBy?: string;
  capturedAt?: string;
}

export interface McpManifest {
  schemaVersion: 1;
  /** Primary key, e.g. `api.example.com`. */
  apiHost: string;
  /** Origin every `pathTemplate` is relative to, e.g. `https://api.example.com`. */
  baseUrl: string;
  /** Sites observed calling this API. */
  siteOrigins: string[];
  title: string;
  description: string;
  auth: McpAuth;
  /** Non-secret headers every upstream call needs, e.g. a client version. */
  staticHeaders?: Record<string, string>;
  tools: McpTool[];
  /** Crawler-assigned; bumps when the content changes. */
  version: string;
  /** ISO 8601 timestamp. */
  generatedAt: string;
  source: McpSource;
}
