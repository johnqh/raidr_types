/** Header an MCP client sends so the hosted server can forward the user's site token. */
export const RAIDR_TOKEN_HEADER = 'X-Raidr-Token';

/** Header carrying the shared write key for raidr_api. */
export const RAIDR_API_KEY_HEADER = 'X-API-Key';

/** Path prefix of the hosted MCP endpoint: `${apiBaseUrl}/mcp/${apiHost}`. */
export const MCP_PROXY_PATH = '/mcp';

/** Allowed shape of an MCP tool name. */
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** Current manifest schema version. */
export const MCP_SCHEMA_VERSION = 1 as const;
