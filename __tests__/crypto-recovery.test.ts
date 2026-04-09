import { generateRecoveryKey, createRecoveryData, recoverPassword } from '../src/utils/crypto';

describe('recovery key functions', () => {
  it('generateRecoveryKey returns a 48-char hex string', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^[0-9a-f]{48}$/);
  });

  it('createRecoveryData and recoverPassword round-trip', async () => {
    const password = 'my-secret-password';
    const recoveryKey = generateRecoveryKey();
    const recoveryData = await createRecoveryData(password, recoveryKey);
    const recovered = await recoverPassword(recoveryData, recoveryKey);
    expect(recovered).toBe(password);
  });

  it('recoverPassword fails with wrong key', async () => {
    const password = 'my-secret-password';
    const recoveryKey = generateRecoveryKey();
    const wrongKey = generateRecoveryKey();
    const recoveryData = await createRecoveryData(password, recoveryKey);
    await expect(recoverPassword(recoveryData, wrongKey)).rejects.toThrow();
  });
});
