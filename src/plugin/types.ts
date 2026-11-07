/**
 * TypeScript type definitions for the Windsurf plugin
 */

/**
 * Chat message source types for protobuf encoding
 */
export const ChatMessageSource = {
  UNSPECIFIED: 0,
  USER: 1,
  SYSTEM: 2,
  ASSISTANT: 3,
  TOOL: 4,
} as const;

export type ChatMessageSourceValue = (typeof ChatMessageSource)[keyof typeof ChatMessageSource];

// ============================================================================
// Authentication Types
// ============================================================================

/** Firebase authentication data stored by Windsurf */
export interface FirebaseAuthData {
  /** Firebase ID token (JWT) */
  idToken: string;
  /** Refresh token for getting new ID tokens */
  refreshToken: string;
  /** Token expiry timestamp (ms) */
  expiresAt: number;
  /** User's email */
  email?: string;
  /** User's display name */
  displayName?: string;
  /** Firebase user ID */
  uid?: string;
}

/** Windsurf account stored by the plugin */
export interface WindsurfAccount {
  /** Account identifier (email or UID) */
  id: string;
  /** Display name for the account */
  name: string;
  /** Firebase authentication data */
  auth: FirebaseAuthData;
  /** Codeium API key (if separate from Firebase token) */
  apiKey?: string;
  /** Installation ID */
  installationId?: string;
  /** Account status */
  status: 'active' | 'expired' | 'rate_limited' | 'error';
  /** Last error message if status is 'error' */
  lastError?: string;
  /** Rate limit state */
  rateLimit?: RateLimitState;
  /** When the account was added */
  addedAt: number;
  /** Last successful request timestamp */
  lastUsedAt?: number;
}

/** Rate limit tracking state */
export interface RateLimitState {
  /** Whether currently rate limited */
  isLimited: boolean;
  /** When the rate limit expires (ms) */
  resetAt?: number;
  /** Number of consecutive rate limit hits */
  consecutiveHits: number;
  /** Current backoff duration (ms) */
  backoffMs: number;
}

/** Accounts storage file format */
export interface AccountsStorage {
  /** Storage format version */
  version: number;
  /** Stored accounts */
  accounts: WindsurfAccount[];
  /** Currently selected account ID */
  selectedAccountId?: string;
  /** Plugin settings */
  settings?: PluginSettings;
}

/** Plugin settings */
export interface PluginSettings {
  /** Account selection strategy */
  accountStrategy: 'sticky' | 'round-robin' | 'least-used';
  /** Enable debug logging */
  debug?: boolean;
  /** Custom API server URL (for enterprise) */
  customApiServer?: string;
  /** Custom inference server URL */
  customInferenceServer?: string;
}

// ============================================================================
// gRPC/API Types
// ============================================================================

/** Metadata sent with every gRPC request */
export interface RequestMetadata {
  /** User's API key */
  apiKey: string;
  /** IDE name */
  ideName: string;
  /** IDE version */
  ideVersion: string;
  /** Extension version */
  extensionVersion: string;
  /** Unique session ID */
  sessionId: string;
  /** User locale */
  locale: string;
}

/** Chat message in Windsurf format */
export interface WindsurfChatMessage {
  /** Message role */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** Message content */
  content: string;
  /** Tool call ID (for tool role) */
  toolCallId?: string;
  /** Tool calls made by assistant */
  toolCalls?: WindsurfToolCall[];
}

/** Tool call in Windsurf format */
export interface WindsurfToolCall {
  /** Tool call ID */
  id: string;
  /** Tool/function name */
  name: string;
  /** Arguments as JSON string */
  arguments: string;
}

/** Tool definition in Windsurf format */
export interface WindsurfToolDefinition {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Parameters schema (JSON Schema) */
  parameters: Record<string, unknown>;
}

/** Cascade session info */
export interface CascadeSession {
  /** Session ID */
  cascadeId: string;
  /** Model being used */
  model: string;
  /** Session start time */
  startedAt: number;
  /** Message count */
  messageCount: number;
}

// ============================================================================
// Request/Response Types
// ============================================================================

/** OpenCode request format (what we receive) */
export interface OpenCodeRequest {
  /** Model name */
  model: string;
  /** Messages */
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  }>;
  /** Tools */
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  /** Streaming */
  stream?: boolean;
  /** Temperature */
  temperature?: number;
  /** Max tokens */
  max_tokens?: number;
  /** System instruction */
  system?: string;
}

/** Transformed Windsurf request format */
export interface WindsurfRequest {
  /** Request metadata */
  metadata: RequestMetadata;
  /** Cascade session ID */
  cascadeId?: string;
  /** Model or alias */
  modelOrAlias: string;
  /** Chat messages */
  messages: WindsurfChatMessage[];
  /** Tool definitions */
  tools?: WindsurfToolDefinition[];
  /** Tool choice constraint */
  toolChoice?: 'auto' | 'none' | { name: string };
  /** Generation config */
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

/** Windsurf streaming response chunk */
export interface WindsurfStreamChunk {
  /** Chunk type */
  type: 'content' | 'tool_call' | 'done' | 'error';
  /** Content delta */
  content?: string;
  /** Tool call delta */
  toolCall?: Partial<WindsurfToolCall>;
  /** Error message */
  error?: string;
  /** Usage stats (on done) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// ============================================================================
// Device Flow Types
// ============================================================================

/**
 * Device flow OAuth state
 */
export interface DeviceFlowState {
  /** Device code for polling */
  deviceCode: string;
  /** User code to display */
  userCode: string;
  /** Verification URL */
  verificationUrl: string;
  /** URL with code embedded */
  verificationUrlComplete: string;
  /** Polling interval in seconds */
  interval: number;
  /** Expiry time */
  expiresAt: number;
}
