import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';

const execFileAsync = promisify(execFile);

const SERVICE_NAME = 'envcp';
const ACCOUNT_NAME = 'master-password';

export interface KeychainResult {
  success: boolean;
  error?: string;
}

export interface KeychainBackend {
  store(service: string, account: string, password: string): Promise<KeychainResult>;
  retrieve(service: string, account: string): Promise<string | null>;
  remove(service: string, account: string): Promise<KeychainResult>;
  isAvailable(): Promise<boolean>;
  name: string;
}

// --- macOS Keychain (security CLI) ---

class MacOSKeychain implements KeychainBackend {
  name = 'macOS Keychain';

  async store(service: string, account: string, password: string): Promise<KeychainResult> {
    try {
      // Delete existing entry first (ignore errors)
      try {
        await execFileAsync('security', ['delete-generic-password', '-s', service, '-a', account]);
      } catch { /* entry may not exist */ }

      await execFileAsync('security', [
        'add-generic-password',
        '-s', service,
        '-a', account,
        '-w', password,
        '-U', // update if exists
      ]);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async retrieve(service: string, account: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s', service,
        '-a', account,
        '-w', // output password only
      ]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async remove(service: string, account: string): Promise<KeychainResult> {
    try {
      await execFileAsync('security', ['delete-generic-password', '-s', service, '-a', account]);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('security', ['help']);
      return true;
    } catch {
      // 'security help' exits with code 1 but still indicates the binary exists
      try {
        await execFileAsync('which', ['security']);
        return true;
      } catch {
        return false;
      }
    }
  }
}

// --- Linux libsecret (secret-tool CLI) ---

class LinuxKeychain implements KeychainBackend {
  name = 'GNOME Keyring (libsecret)';

  async store(service: string, account: string, password: string): Promise<KeychainResult> {
    try {
      const proc = execFileAsync('secret-tool', [
        'store',
        '--label', `${service} password`,
        'service', service,
        'account', account,
      ]);
      // secret-tool reads the secret from stdin
      proc.child.stdin!.write(password);
      proc.child.stdin!.end();
      await proc;
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async retrieve(service: string, account: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('secret-tool', [
        'lookup',
        'service', service,
        'account', account,
      ]);
      return stdout || null;
    } catch {
      return null;
    }
  }

  async remove(service: string, account: string): Promise<KeychainResult> {
    try {
      await execFileAsync('secret-tool', [
        'clear',
        'service', service,
        'account', account,
      ]);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('which', ['secret-tool']);
      return true;
    } catch {
      return false;
    }
  }
}

// --- Windows Credential Manager (PowerShell) ---

class WindowsKeychain implements KeychainBackend {
  name = 'Windows Credential Manager';

  async store(service: string, account: string, password: string): Promise<KeychainResult> {
    try {
      // Use cmdkey for simplicity
      const target = `${service}:${account}`;
      await execFileAsync('cmdkey', ['/add:' + target, '/user:' + account, '/pass:' + password]);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async retrieve(service: string, account: string): Promise<string | null> {
    try {
      // cmdkey can't retrieve passwords; use PowerShell CredentialManager
      const target = `${service}:${account}`;
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `$cred = Get-StoredCredential -Target '${target.replaceAll("'", "''")}'; if ($cred) { $cred.GetNetworkCredential().Password } else { '' }`,
      ]);
      return stdout.trim() || null;
    } catch {
      // Fallback: try with cmdkey-based approach via PowerShell DPAPI
      try {
        const { stdout } = await execFileAsync('powershell', [
          '-NoProfile', '-Command',
          `[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((New-Object Management.Automation.PSCredential('u',(Get-Content '${os.homedir()}/.envcp/.credential' | ConvertTo-SecureString))).Password))`,
        ]);
        return stdout.trim() || null;
      } catch {
        return null;
      }
    }
  }

  async remove(service: string, account: string): Promise<KeychainResult> {
    try {
      const target = `${service}:${account}`;
      await execFileAsync('cmdkey', ['/delete:' + target]);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('where', ['cmdkey']);
      return true;
    } catch {
      return false;
    }
  }
}

// --- Keychain manager ---

export class KeychainManager {
  private backend: KeychainBackend;
  private service: string;

  constructor(service: string = SERVICE_NAME) {
    this.service = service;
    const platform = os.platform();
    if (platform === 'darwin') {
      this.backend = new MacOSKeychain();
    } else if (platform === 'win32') {
      this.backend = new WindowsKeychain();
    } else {
      this.backend = new LinuxKeychain();
    }
  }

  get backendName(): string {
    return this.backend.name;
  }

  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable();
  }

  async storePassword(password: string, projectPath?: string): Promise<KeychainResult> {
    const account = projectPath ? `${ACCOUNT_NAME}:${projectPath}` : ACCOUNT_NAME;
    return this.backend.store(this.service, account, password);
  }

  async retrievePassword(projectPath?: string): Promise<string | null> {
    const account = projectPath ? `${ACCOUNT_NAME}:${projectPath}` : ACCOUNT_NAME;
    return this.backend.retrieve(this.service, account);
  }

  async removePassword(projectPath?: string): Promise<KeychainResult> {
    const account = projectPath ? `${ACCOUNT_NAME}:${projectPath}` : ACCOUNT_NAME;
    return this.backend.remove(this.service, account);
  }

  async getStatus(projectPath?: string): Promise<{ available: boolean; backend: string; hasPassword: boolean }> {
    const available = await this.isAvailable();
    const hasPassword = available ? (await this.retrievePassword(projectPath)) !== null : false;
    return { available, backend: this.backend.name, hasPassword };
  }
}
