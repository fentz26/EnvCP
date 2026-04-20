import { z } from 'zod';
import * as path from 'path';

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

export const AuditFieldsSchema = z.object({
  session_id: z.boolean().default(true),
  client_id: z.boolean().default(true),
  client_type: z.boolean().default(true),
  ip: z.boolean().default(true),
  user_agent: z.boolean().default(false),
  purpose: z.boolean().default(false),
  duration_ms: z.boolean().default(true),
  variable: z.boolean().default(true),
  message: z.boolean().default(true),
}).default({});

export const AuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  retain_days: z.number().int().min(1).default(30),
  fields: AuditFieldsSchema,
  hmac: z.boolean().default(false),
  hmac_key_path: z.string().default('.envcp/.audit-hmac-key'),
  hmac_chain: z.boolean().default(false),
  log_path: z.string().optional(),
  protection: z.enum(['none', 'append_only', 'immutable', 'remote']).default('none'),
  remote_ship: z.object({
    type: z.enum(['syslog', 'http', 'file']).optional(),
    endpoint: z.string().optional(),
    api_key: z.string().optional(),
    batch_size: z.number().int().positive().default(100),
    retry_count: z.number().int().min(0).max(5).default(3),
  }).optional(),
}).default({});

export type AuditConfig = z.infer<typeof AuditConfigSchema>;

export const EnvCPConfigSchema = z.object({
  version: z.string().default('1.0'),
  project: z.string().optional(),

  vault: z.object({
    mode: VaultModeSchema.optional(),
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
    allow_ai_logs: z.boolean().default(false),
    logs_default_role: z.enum(['full', 'own_sessions', 'readonly', 'none']).default('own_sessions'),
    logs_roles: z.record(z.enum(['full', 'own_sessions', 'readonly', 'none'])).default({ cli: 'full' }),
    require_user_reference: z.boolean().default(true),
    allowed_commands: z.array(z.string()).optional(),
    require_confirmation: z.boolean().default(true),
    mask_values: z.boolean().default(true),
    audit_log: z.boolean().default(true),
    allowed_patterns: z.array(z.string()).optional(),
    denied_patterns: z.array(z.string()).optional(),
    blacklist_patterns: z.array(z.string()).default([]),
    require_variable_password: z.boolean().default(false),
    command_blacklist: z.array(z.string()).default([]),
    run_safety: z.object({
      disallow_root_delete: z.boolean().default(true),
      disallow_path_manipulation: z.boolean().default(true),
      require_command_whitelist: z.boolean().default(false),
      scrub_output: z.boolean().default(true),
      redact_patterns: z.array(z.string()).default([]),
    }).default({}),
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
    lockout_threshold: z.number().int().min(1).default(5),
    lockout_base_seconds: z.number().int().min(1).default(60),
  }).default({}),

  encryption: z.object({
    enabled: z.boolean().default(true),
  }).default({}),

  keychain: z.object({
    enabled: z.boolean().default(false),
    service: z.string().default('envcp'),
  }).default({}),

  hsm: z.object({
    enabled: z.boolean().default(false),
    type: z.enum(['yubikey', 'gpg', 'pkcs11']).default('yubikey'),
    serial: z.string().optional(),
    require_touch: z.boolean().default(true),
    key_id: z.string().optional(),
    pkcs11_lib: z.string().optional(),
    slot: z.number().optional(),
    protected_key_path: z.string().default('.envcp/.hsm-key'),
  }).default({}),

  auth: z.object({
    method: z.enum(['password', 'keychain', 'hsm', 'multi']).default('password'),
    multi_factors: z.array(z.enum(['password', 'keychain', 'hsm'])).default(['password', 'hsm']),
    fallback: z.enum(['recovery_key', 'password', 'none']).default('password'),
  }).default({}),

  security: z.object({
    mode: z.enum(['hard-lock', 'recoverable']).default('recoverable'),
    recovery_file: z.string().default('.envcp/.recovery'),
    brute_force_protection: z.object({
      enabled: z.boolean().default(true),
      max_attempts: z.number().int().min(1).default(5),
      lockout_duration: z.number().int().min(1).default(300),
      progressive_delay: z.boolean().default(true),
      max_delay: z.number().int().min(0).default(60),
      permanent_lockout_threshold: z.number().int().min(0).default(50),
      permanent_lockout_action: z.enum(['require_recovery_key', 'require_admin', 'permanent_lock']).default('require_recovery_key'),
      notifications: z.object({}).default({}),
    }).default({}),
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

  audit: AuditConfigSchema,

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
  protected: z.boolean().default(false),
  password_hash: z.string().optional(),
  protected_value: z.string().optional(),
});

export type Variable = z.infer<typeof VariableSchema>;

export type LogsRole = 'full' | 'own_sessions' | 'readonly' | 'none';

export const OperationLogSchema = z.object({
  timestamp: z.string(),
  operation: z.enum(['add', 'get', 'update', 'delete', 'list', 'sync', 'export', 'unlock', 'lock', 'check_access', 'run', 'auth_failure', 'permanent_lockout', 'lockout_triggered']),
  variable: z.string().optional(),
  source: z.enum(['cli', 'mcp', 'api']),
  success: z.boolean(),
  message: z.string().optional(),
  session_id: z.string().optional(),
  client_id: z.string().optional(),
  client_type: z.string().optional(),
  ip: z.string().optional(),
  user_agent: z.string().optional(),
  purpose: z.string().optional(),
  duration_ms: z.number().optional(),
  hmac: z.string().optional(),
  prev_hmac: z.string().optional(),
  chain_index: z.number().optional(),
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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

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

export interface RESTResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export type ClientType = 'mcp' | 'openai' | 'gemini' | 'rest' | 'unknown';
