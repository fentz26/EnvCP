import { z } from 'zod';

export const EnvCPConfigSchema = z.object({
  version: z.string().default('1.0'),
  project: z.string().optional(),
  
  storage: z.object({
    path: z.string().default('.envcp/store.enc'),
    encrypted: z.boolean().default(true),
    algorithm: z.enum(['aes-256-gcm', 'aes-256-cbc']).default('aes-256-gcm'),
    compression: z.boolean().default(false),
  }).default({}),
  
  access: z.object({
    allow_ai_read: z.boolean().default(false),
    allow_ai_write: z.boolean().default(false),
    allow_ai_delete: z.boolean().default(false),
    allow_ai_export: z.boolean().default(false),
    allow_ai_active_check: z.boolean().default(false),
    require_user_reference: z.boolean().default(true),
    require_confirmation: z.boolean().default(true),
    mask_values: z.boolean().default(true),
    audit_log: z.boolean().default(true),
    allowed_patterns: z.array(z.string()).optional(),
    denied_patterns: z.array(z.string()).optional(),
    blacklist_patterns: z.array(z.string()).default([]),
  }).default({}),
  
  sync: z.object({
    enabled: z.boolean().default(false),
    target: z.string().default('.env'),
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
  
  password: z.object({
    min_length: z.number().default(1),
    require_complexity: z.boolean().default(false),
    allow_numeric_only: z.boolean().default(true),
    allow_single_char: z.boolean().default(true),
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
