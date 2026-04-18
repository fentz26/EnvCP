import { jest, describe, it, expect, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { UnifiedServer } from '../src/server/unified.js';
import { EnvCPConfigSchema, ServerConfig } from '../src/types.js';

const configWithRead = () => EnvCPConfigSchema.parse({
  access: {
    allow_ai_read: true,
    allow_ai_write: false,
    allow_ai_delete: false,
    allow_ai_export: false,
    allow_ai_execute: false,
    allow_ai_active_check: false,
    require_user_reference: false,
    require_confirmation: false,
    mask_values: false,
    blacklist_patterns: [],
  },
  encryption: { enabled: false },
  storage: { encrypted: false, path: '.envcp/store.json' },
  sync: { enabled: false },
});

const configWithExecute = () => EnvCPConfigSchema.parse({
  access: {
    allow_ai_read: true,
    allow_ai_write: true,
    allow_ai_delete: true,
    allow_ai_export: true,
    allow_ai_execute: true,
    allow_ai_active_check: true,
    require_user_reference: false,
    require_confirmation: false,
    mask_values: false,
    blacklist_patterns: [],
  },
  encryption: { enabled: false },
  storage: { encrypted: false, path: '.envcp/store.json' },
  sync: { enabled: false },
});

const configNoAiFlags = () => EnvCPConfigSchema.parse({
  access: {
    allow_ai_read: false,
    allow_ai_write: false,
    allow_ai_delete: false,
    allow_ai_export: false,
    allow_ai_execute: false,
    allow_ai_active_check: false,
    require_user_reference: false,
    require_confirmation: false,
    mask_values: false,
    blacklist_patterns: [],
  },
  encryption: { enabled: false },
  storage: { encrypted: false, path: '.envcp/store.json' },
  sync: { enabled: false },
});

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  tmpDirs.length = 0;
});

async function tmpDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-apikey-'));
  tmpDirs.push(d);
  return d;
}

describe('API key enforcement for HTTP modes', () => {
  it('throws when allow_ai_read=true and no api_key (rest mode)', async () => {
    const dir = await tmpDir();
    const serverConfig: ServerConfig = { mode: 'rest', port: 0, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(configWithRead(), serverConfig, dir);
    await expect(server.start()).rejects.toThrow('no api_key is set');
    server.stop();
  });

  it('throws when allow_ai_read=true and no api_key (openai mode)', async () => {
    const dir = await tmpDir();
    const serverConfig: ServerConfig = { mode: 'openai', port: 0, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(configWithRead(), serverConfig, dir);
    await expect(server.start()).rejects.toThrow('no api_key is set');
    server.stop();
  });

  it('throws when allow_ai_read=true and no api_key (gemini mode)', async () => {
    const dir = await tmpDir();
    const serverConfig: ServerConfig = { mode: 'gemini', port: 0, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(configWithRead(), serverConfig, dir);
    await expect(server.start()).rejects.toThrow('no api_key is set');
    server.stop();
  });

  it('throws when allow_ai_read=true and no api_key (auto mode)', async () => {
    const dir = await tmpDir();
    const serverConfig: ServerConfig = { mode: 'auto', port: 0, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(configWithRead(), serverConfig, dir);
    await expect(server.start()).rejects.toThrow('no api_key is set');
    server.stop();
  });

  it('starts successfully when api_key is provided', async () => {
    const dir = await tmpDir();
    const serverConfig: ServerConfig = {
      mode: 'auto',
      port: 0,
      host: '127.0.0.1',
      cors: true,
      auto_detect: false,
      api_key: 'test-secret-key',
    };
    const server = new UnifiedServer(configWithRead(), serverConfig, dir);
    await server.start();
    server.stop();
  });

  it('starts successfully when no AI flags are enabled and no api_key', async () => {
    const dir = await tmpDir();
    const serverConfig: ServerConfig = { mode: 'rest', port: 0, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(configNoAiFlags(), serverConfig, dir);
    await server.start();
    server.stop();
  });

  it('still throws the specific allow_ai_execute error', async () => {
    const dir = await tmpDir();
    const serverConfig: ServerConfig = { mode: 'rest', port: 0, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(configWithExecute(), serverConfig, dir);
    await expect(server.start()).rejects.toThrow('allow_ai_execute is enabled but no api_key is set');
    server.stop();
  });
});
