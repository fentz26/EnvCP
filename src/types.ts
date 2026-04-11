import { z } from 'zod';
import * as path from 'path';

// Server mode types (defined first for use in EnvCPConfigSchema)
export const ServerModeSchema = z.enum(['mcp', 'rest', 'openai', 'gemini', 'all', 'auto']);
export type ServerMode = z.infer<typeof ServerModeSchema>;

export const RateLimitConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requests_per_minute: z.number().int().positive().default(60),
  whitelist: z.array(z.string()).default([]),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

export const VaultModeSchema = z.enum(['project', 'global']);
export type VaultMode = z.infer<typeof VaultModeSchema>;

export const EnvCPConfigSchema = z.object({
  version: z.string().default('1.0'),
  project: z.string().optional(),

  vault: z.object({
    default: VaultModeSchema.default('project'),
    global_path: z.string().default('.envcp/store.enc'),
  }).default({}),

  storage: z.object({
    path: z.string().default('.envcp/store.enc'),
    encrypted: z.boolean().default(true),
  }).default({}),

  access: z.object({
    allow_ai_read: z.boolean().default(false),
    allow_ai_write: z.boolean().default(false),
    allow_ai_delete: z.boolean().default(false),
    allow_ai_export: z.boolean().default(false),
    allow_ai_execute: z.boolean().default(false),
    allow_ai_active_check: z.boolean().default(false),
    require_user_reference: z.boolean().default(true),
    allowed_commands: z.array(z.string()).optional(),
    require_confirmation: z.boolean().default(true),
    mask_values: z.boolean().default(true),
    audit_log: z.boolean().default(true),
    allowed_patterns: z.array(z.string()).optional(),
    denied_patterns: z.array(z.string()).optional(),
    blacklist_patterns: z.array(z.string()).default([]),
  }).default({}),

  sync: z.object({
    enabled: z.boolean().default(false),
    target: z.string()
    .refine((value) => !path.isAbsolute(value), {
      message: 'sync.target must be a relative path within the project directory',
    })
    .default('.env'),
    exclude: z.array(z.string()).default([]),
    include: z.array(z.string()).optional(),
    format: z.enum(['dotenv', 'json', 'yaml']).default('dotenv'),
    header: z.string().optional(),
  }).default({}),

  session: z.object({
    enabled: z.boolean().default(true),
    timeout_minutes: z.number().default(30),
    max_extensions: z.number().default(5),
    path: z.string().default('.envcp/.session'),
  }).default({}),

  encryption: z.object({
    enabled: z.boolean().default(true),
  }).default({}),

  keychain: z.object({
    enabled: z.boolean().default(false),
    service: z.string().default('envcp'),
  }).default({}),

  security: z.object({
    mode: z.enum(['hard-lock', 'recoverable']).default('recoverable'),
    recovery_file: z.string().default('.envcp/.recovery'),
  }).default({}),

  password: z.object({
    min_length: z.number().default(8),
    require_complexity: z.boolean().default(false),
    allow_numeric_only: z.boolean().default(false),
    allow_single_char: z.boolean().default(false),
  }).default({}),

  variables: z.record(z.object({
    value: z.string(),
    encrypted: z.boolean().default(false),
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
    accessed: z.string().optional(),
    sync_to_env: z.boolean().default(true),
  })).optional(),

  server: z.object({
    mode: ServerModeSchema.optional(),
    port: z.number().optional(),
    host: z.string().optional(),
    cors: z.boolean().optional(),
    api_key: z.string().optional(),
    auto_detect: z.boolean().optional(),
    rate_limit: RateLimitConfigSchema.optional(),
  }).optional(),
});

export type EnvCPConfig = z.infer<typeof EnvCPConfigSchema>;

export const VariableSchema = z.object({
  name: z.string(),
  value: z.string(),
  encrypted: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  created: z.string(),
  updated: z.string(),
  accessed: z.string().optional(),
  sync_to_env: z.boolean().default(true),
});

export type Variable = z.infer<typeof VariableSchema>;

export const OperationLogSchema = z.object({
  timestamp: z.string(),
  operation: z.enum(['add', 'get', 'update', 'delete', 'list', 'sync', 'export', 'unlock', 'lock', 'check_access']),
  variable: z.string().optional(),
  source: z.enum(['cli', 'mcp', 'api']),
  success: z.boolean(),
  message: z.string().optional(),
});

export type OperationLog = z.infer<typeof OperationLogSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  created: z.string(),
  expires: z.string(),
  extensions: z.number().default(0),
  last_access: z.string(),
});

export type Session = z.infer<typeof SessionSchema>;

export const ServerConfigSchema = z.object({
  mode: ServerModeSchema.default('auto'),
  port: z.number().default(3456),
  host: z.string().default('127.0.0.1'),
  cors: z.boolean().default(true),
  api_key: z.string().optional(),
  auto_detect: z.boolean().default(true),
  rate_limit: RateLimitConfigSchema.optional(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// Tool definition for adapters
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

// OpenAI function calling format
export interface OpenAIFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

// Gemini function calling format
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

// REST API types
export interface RESTResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// Detected client type
export type ClientType = 'mcp' | 'openai' | 'gemini' | 'rest' | 'unknown';
