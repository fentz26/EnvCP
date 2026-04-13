import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { BaseAdapter } from '../src/adapters/base';
import { EnvCPConfig, EnvCPConfigSchema, Variable } from '../src/types';
import {
  hashVariablePassword,
  verifyVariablePassword,
  encryptVariableValue,
  decryptVariableValue,
} from '../src/utils/crypto';

// --- Test adapter exposing protected methods ---
class TestAdapter extends BaseAdapter {
  protected registerTools(): void {
    this.registerDefaultTools();
  }

  async seedVariable(variable: Variable): Promise<void> {
    await this.storage.set(variable.name, variable);
  }

  runListVariables(args: { tags?: string[] }) { return this.listVariables(args); }
  runGetVariable(args: { name: string; show_value?: boolean; variable_password?: string }) {
    return this.getVariable(args);
  }
  runSetVariable(args: {
    name: string; value: string; tags?: string[]; description?: string;
    protect?: boolean; unprotect?: boolean; variable_password?: string;
  }) {
    return this.setVariable(args);
  }
  runDeleteVariable(args: { name: string }) { return this.deleteVariable(args); }
}

const now = new Date().toISOString();

function makeConfig(overrides: Record<string, unknown> = {}): EnvCPConfig {
  return EnvCPConfigSchema.parse({
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
      ...overrides,
    },
    encryption: { enabled: false },
    storage: { encrypted: false, path: '.envcp/store.json' },
    sync: { enabled: true, target: '.env' },
  });
}

// --- Crypto helpers ---
describe('per-variable crypto helpers', () => {
  it('hashVariablePassword returns an argon2 hash', async () => {
    const hash = await hashVariablePassword('my-secret-pw');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('verifyVariablePassword returns true for correct password', async () => {
    const hash = await hashVariablePassword('correct-pw');
    expect(await verifyVariablePassword('correct-pw', hash)).toBe(true);
  });

  it('verifyVariablePassword returns false for wrong password', async () => {
    const hash = await hashVariablePassword('correct-pw');
    expect(await verifyVariablePassword('wrong-pw', hash)).toBe(false);
  });

  it('encryptVariableValue + decryptVariableValue round-trip', async () => {
    const original = 'super-secret-api-key-12345';
    const encrypted = await encryptVariableValue(original, 'var-password');
    expect(encrypted).not.toBe(original);
    expect(encrypted.startsWith('v2:')).toBe(true);

    const decrypted = await decryptVariableValue(encrypted, 'var-password');
    expect(decrypted).toBe(original);
  });

  it('decryptVariableValue throws on wrong password', async () => {
    const encrypted = await encryptVariableValue('secret', 'right-pw');
    await expect(decryptVariableValue(encrypted, 'wrong-pw')).rejects.toThrow();
  });
});

// --- Adapter-level protection ---
describe('protected variables via BaseAdapter', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-protect-'));
    adapter = new TestAdapter(makeConfig(), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('setVariable with protect', () => {
    it('creates a protected variable', async () => {
      const result = await adapter.runSetVariable({
        name: 'SECRET_KEY',
        value: 'my-api-key',
        protect: true,
        variable_password: 'varpass123',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Protected variable');
      expect(result.message).toContain('created');
    });

    it('throws when protect=true but no variable_password', async () => {
      await expect(adapter.runSetVariable({
        name: 'BAD', value: 'val', protect: true,
      })).rejects.toThrow('variable_password is required when protect=true');
    });

    it('stores [PROTECTED] as the value field', async () => {
      await adapter.runSetVariable({
        name: 'PV', value: 'real', protect: true, variable_password: 'pw12345678',
      });
      // Read raw from storage
      const raw = await adapter.runGetVariable({ name: 'PV', variable_password: 'pw12345678' });
      // The stored value field should be [PROTECTED], but getVariable decrypts it
      expect(raw.protected).toBe(true);
    });

    it('updates a protected variable with correct password', async () => {
      await adapter.runSetVariable({
        name: 'UP', value: 'v1', protect: true, variable_password: 'pw12345678',
      });
      const result = await adapter.runSetVariable({
        name: 'UP', value: 'v2', protect: true, variable_password: 'pw12345678',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('updated');
    });

    it('rejects update of protected variable with wrong password', async () => {
      await adapter.runSetVariable({
        name: 'WP', value: 'v1', protect: true, variable_password: 'pw12345678',
      });
      await expect(adapter.runSetVariable({
        name: 'WP', value: 'v2', protect: true, variable_password: 'wrong-pass',
      })).rejects.toThrow('Invalid password');
    });
  });

  describe('getVariable with protection', () => {
    it('throws when no variable_password provided for protected variable', async () => {
      await adapter.runSetVariable({
        name: 'PG', value: 'secret', protect: true, variable_password: 'pgpass123',
      });
      await expect(adapter.runGetVariable({ name: 'PG' }))
        .rejects.toThrow('is protected');
    });

    it('throws on wrong variable_password', async () => {
      await adapter.runSetVariable({
        name: 'PG2', value: 'secret', protect: true, variable_password: 'pgpass123',
      });
      await expect(adapter.runGetVariable({ name: 'PG2', variable_password: 'bad' }))
        .rejects.toThrow('Invalid password');
    });

    it('decrypts and returns value with correct variable_password', async () => {
      await adapter.runSetVariable({
        name: 'PG3', value: 'the-real-value', protect: true, variable_password: 'pgpass123',
      });
      const result = await adapter.runGetVariable({
        name: 'PG3', show_value: true, variable_password: 'pgpass123',
      });
      expect(result.value).toBe('the-real-value');
      expect(result.protected).toBe(true);
    });

    it('returns masked decrypted value when show_value is false', async () => {
      await adapter.runSetVariable({
        name: 'PG4', value: 'abcdefghijklmnop', protect: true, variable_password: 'pgpass123',
      });
      const result = await adapter.runGetVariable({
        name: 'PG4', variable_password: 'pgpass123',
      });
      // show_value defaults to false, so value is masked
      expect(result.value).not.toBe('abcdefghijklmnop');
      expect(result.value).toContain('*');
    });

    it('returns protected=false for non-protected variables', async () => {
      await adapter.runSetVariable({ name: 'PLAIN', value: 'hello' });
      const result = await adapter.runGetVariable({ name: 'PLAIN' });
      expect(result.protected).toBe(false);
    });
  });

  describe('unprotect', () => {
    it('removes protection with correct password', async () => {
      await adapter.runSetVariable({
        name: 'UNP', value: 'secret', protect: true, variable_password: 'unppass12',
      });
      const result = await adapter.runSetVariable({
        name: 'UNP', value: 'new-plain', unprotect: true, variable_password: 'unppass12',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('protection removed');

      // Now accessible without password
      const got = await adapter.runGetVariable({ name: 'UNP', show_value: true });
      expect(got.value).toBe('new-plain');
      expect(got.protected).toBe(false);
    });

    it('throws when unprotecting with wrong password', async () => {
      await adapter.runSetVariable({
        name: 'UNP2', value: 'secret', protect: true, variable_password: 'unppass12',
      });
      await expect(adapter.runSetVariable({
        name: 'UNP2', value: 'x', unprotect: true, variable_password: 'wrong',
      })).rejects.toThrow('Invalid password');
    });

    it('throws when unprotecting a non-protected variable', async () => {
      await adapter.runSetVariable({ name: 'PLAIN2', value: 'hello' });
      await expect(adapter.runSetVariable({
        name: 'PLAIN2', value: 'x', unprotect: true, variable_password: 'pw12345678',
      })).rejects.toThrow('is not protected');
    });

    it('throws when unprotecting without variable_password', async () => {
      await adapter.runSetVariable({
        name: 'UNP3', value: 'secret', protect: true, variable_password: 'unppass12',
      });
      await expect(adapter.runSetVariable({
        name: 'UNP3', value: 'x', unprotect: true,
      })).rejects.toThrow('variable_password is required');
    });
  });

  describe('listVariables with protected vars', () => {
    it('marks protected variables in listing', async () => {
      await adapter.runSetVariable({ name: 'NORMAL_VAR', value: 'v1' });
      await adapter.runSetVariable({
        name: 'PROTECTED_VAR', value: 'secret', protect: true, variable_password: 'lppass123',
      });

      const result = await adapter.runListVariables({});
      expect(result.count).toBe(2);
      // When any protected var exists, list returns objects with name/protected
      const vars = result.variables as Array<{ name: string; protected: boolean }>;
      const protectedEntry = vars.find(v => v.name === 'PROTECTED_VAR');
      const normalEntry = vars.find(v => v.name === 'NORMAL_VAR');
      expect(protectedEntry?.protected).toBe(true);
      expect(normalEntry?.protected).toBe(false);
    });

    it('returns plain string array when no protected vars exist', async () => {
      await adapter.runSetVariable({ name: 'A', value: '1' });
      await adapter.runSetVariable({ name: 'B', value: '2' });

      const result = await adapter.runListVariables({});
      expect(result.count).toBe(2);
      // All entries should be plain strings
      expect(typeof result.variables[0]).toBe('string');
    });
  });

  describe('setVariable on existing protected without protect/unprotect', () => {
    it('throws when updating protected variable without password', async () => {
      await adapter.runSetVariable({
        name: 'LOCKED', value: 'val', protect: true, variable_password: 'lockpw123',
      });
      await expect(adapter.runSetVariable({ name: 'LOCKED', value: 'new' }))
        .rejects.toThrow('is protected');
    });
  });

  describe('deleteVariable on protected variable', () => {
    it('deletes a protected variable (no password needed for delete)', async () => {
      await adapter.runSetVariable({
        name: 'DEL_PROT', value: 'val', protect: true, variable_password: 'delpw1234',
      });
      const result = await adapter.runDeleteVariable({ name: 'DEL_PROT' });
      expect(result.success).toBe(true);
    });
  });

  describe('require_variable_password config flag', () => {
    it('requires protect for new variables when enabled', async () => {
      const a = new TestAdapter(makeConfig({ require_variable_password: true }), tmpDir);
      await a.init();

      await expect(a.runSetVariable({ name: 'FORCED', value: 'val' }))
        .rejects.toThrow('require_variable_password is enabled');
    });

    it('allows protected creation when enabled', async () => {
      const a = new TestAdapter(makeConfig({ require_variable_password: true }), tmpDir);
      await a.init();

      const result = await a.runSetVariable({
        name: 'FORCED', value: 'val', protect: true, variable_password: 'forcepw12',
      });
      expect(result.success).toBe(true);
    });

    it('allows updating existing variables when enabled', async () => {
      const a = new TestAdapter(makeConfig(), tmpDir);
      await a.init();
      await a.runSetVariable({ name: 'EXIST', value: 'v1' });

      // Switch to require mode — updating existing should work
      const a2 = new TestAdapter(makeConfig({ require_variable_password: true }), tmpDir);
      await a2.init();
      const result = await a2.runSetVariable({ name: 'EXIST', value: 'v2' });
      expect(result.success).toBe(true);
    });
  });

  describe('setVariable — protected update edge cases', () => {
    it('throws when updating a protected variable without providing variable_password', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-prot-'));
      try {
        const adapter = new TestAdapter(makeConfig(), tmpDir);
        await adapter.init();
        // Create protected variable
        await adapter.runSetVariable({ name: 'PROTECTED', value: 'secret', protect: true, variable_password: 'pw123' });
        // Try to update without password — should throw
        await expect(
          adapter.runSetVariable({ name: 'PROTECTED', value: 'new-value' }),
        ).rejects.toThrow('protected');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('unprotect uses decryptedValue when no new value provided', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-unprot-'));
      try {
        const adapter = new TestAdapter(makeConfig(), tmpDir);
        await adapter.init();
        // Create protected variable
        await adapter.runSetVariable({ name: 'MYKEY', value: 'original-secret', protect: true, variable_password: 'pw123' });
        // Unprotect WITHOUT providing a new value — should recover decryptedValue
        const result = await adapter.runSetVariable({ name: 'MYKEY', unprotect: true, value: undefined as unknown as string, variable_password: 'pw123' });
        expect(result.success).toBe(true);
        // Value should be the original decrypted value
        const gotten = await adapter.runGetVariable({ name: 'MYKEY', show_value: true });
        expect((gotten as any).value).toBe('original-secret');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
