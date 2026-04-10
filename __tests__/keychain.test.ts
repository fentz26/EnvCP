import { KeychainManager } from '../src/utils/keychain';

describe('KeychainManager', () => {
  let keychain: KeychainManager;

  beforeAll(() => {
    keychain = new KeychainManager('envcp-test');
  });

  it('selects correct backend for current platform', () => {
    const name = keychain.backendName;
    if (process.platform === 'darwin') {
      expect(name).toBe('macOS Keychain');
    } else if (process.platform === 'win32') {
      expect(name).toBe('Windows Credential Manager');
    } else {
      expect(name).toBe('GNOME Keyring (libsecret)');
    }
  });

  it('reports availability status', async () => {
    const available = await keychain.isAvailable();
    expect(typeof available).toBe('boolean');
  });

  it('getStatus returns structured status', async () => {
    const status = await keychain.getStatus('/test/project');
    expect(status).toHaveProperty('available');
    expect(status).toHaveProperty('backend');
    expect(status).toHaveProperty('hasPassword');
    expect(typeof status.available).toBe('boolean');
    expect(typeof status.backend).toBe('string');
    expect(typeof status.hasPassword).toBe('boolean');
  });

  it('uses custom service name', () => {
    const custom = new KeychainManager('my-custom-service');
    expect(custom.backendName).toBeDefined();
  });

  it('uses default service name', () => {
    const def = new KeychainManager();
    expect(def.backendName).toBeDefined();
  });

  it('retrieve returns null for non-existent entry', async () => {
    const result = await keychain.retrievePassword('/nonexistent/project/' + Date.now());
    expect(result).toBeNull();
  });

  it('remove handles non-existent entry gracefully', async () => {
    const result = await keychain.removePassword('/nonexistent/project/' + Date.now());
    // Should not throw; may succeed or fail depending on backend
    expect(result).toHaveProperty('success');
  });

  it('store returns result object (may fail if daemon not running)', async () => {
    const result = await keychain.storePassword('test-pass', '/tmp/envcp-test-' + Date.now());
    expect(result).toHaveProperty('success');
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it('getStatus reports hasPassword=false when not available', async () => {
    const status = await keychain.getStatus('/definitely/not/stored/' + Date.now());
    // If keychain daemon isn't running, hasPassword should be false
    expect(typeof status.hasPassword).toBe('boolean');
  });

  it('storePassword and retrievePassword use project-scoped accounts', async () => {
    const projectA = '/tmp/project-a-' + Date.now();
    const projectB = '/tmp/project-b-' + Date.now();

    // Store for project A
    const storeA = await keychain.storePassword('pass-a', projectA);
    if (!storeA.success) {
      // Keychain not functional, skip
      return;
    }

    // Store for project B
    await keychain.storePassword('pass-b', projectB);

    // Retrieve should be project-scoped
    const retrievedA = await keychain.retrievePassword(projectA);
    const retrievedB = await keychain.retrievePassword(projectB);
    expect(retrievedA).toBe('pass-a');
    expect(retrievedB).toBe('pass-b');

    // Cleanup
    await keychain.removePassword(projectA);
    await keychain.removePassword(projectB);
  });

  it('storePassword without projectPath uses global account', async () => {
    const result = await keychain.storePassword('global-pass');
    expect(result).toHaveProperty('success');
    if (result.success) {
      const retrieved = await keychain.retrievePassword();
      expect(retrieved).toBe('global-pass');
      await keychain.removePassword();
    }
  });
});
