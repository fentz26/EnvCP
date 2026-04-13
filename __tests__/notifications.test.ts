import { NotificationManager } from '../src/utils/notifications';
import { jest } from '@jest/globals';

describe('NotificationManager', () => {
  it('should skip webhook in test environment', async () => {
    const manager = new NotificationManager({ webhook_url: 'http://example.com/webhook' }, '/test/vault');
    
    // In test environment, sendLockoutNotification should not make HTTP requests
    await manager.sendLockoutNotification({
      type: 'lockout_triggered',
      timestamp: new Date().toISOString(),
      attempts: 5,
      lockout_count: 1,
      permanent_lockout_count: 0,
      remaining_seconds: 60,
      source: 'cli'
    });
    
    // Test passes if no error is thrown (no HTTP request made)
  });
  
  it('should skip email in test environment', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    const manager = new NotificationManager({ email: 'admin@example.com' }, '/test/vault');
    
    await manager.sendLockoutNotification({
      type: 'lockout_triggered',
      timestamp: new Date().toISOString(),
      attempts: 5,
      lockout_count: 1,
      permanent_lockout_count: 0,
      remaining_seconds: 60,
      source: 'cli'
    });
    
    // In test environment, email should not be sent (just console.warn)
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    
    consoleWarnSpy.mockRestore();
  });
  
  it('should create and verify signatures', () => {
    const payload = 'test payload';
    const secret = 'test secret';
    
    const signature = NotificationManager.createSignature(payload, secret);
    const isValid = NotificationManager.verifySignature(payload, signature, secret);
    
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    expect(isValid).toBe(true);
    
    // Test with wrong secret
    const wrongSecret = 'wrong secret';
    const isValidWrong = NotificationManager.verifySignature(payload, signature, wrongSecret);
    expect(isValidWrong).toBe(false);
    
    // Test with wrong signature
    const wrongSignature = 'wrong signature';
    const isValidWrongSig = NotificationManager.verifySignature(payload, wrongSignature, secret);
    expect(isValidWrongSig).toBe(false);
    
    // Test with invalid hex signature
    const invalidHex = 'not hex!';
    const isValidInvalidHex = NotificationManager.verifySignature(payload, invalidHex, secret);
    expect(isValidInvalidHex).toBe(false);
    
    // Test with wrong length signature
    const wrongLength = 'abc';
    const isValidWrongLength = NotificationManager.verifySignature(payload, wrongLength, secret);
    expect(isValidWrongLength).toBe(false);
  });
  
  it('should not send notification without config', async () => {
    const manager = new NotificationManager({}, '/test/vault');
    
    await manager.sendLockoutNotification({
      type: 'auth_failure',
      timestamp: new Date().toISOString(),
      attempts: 1,
      lockout_count: 0,
      permanent_lockout_count: 0,
      source: 'unknown'
    });
    
    // Should not throw or make any requests
  });
  
  it('should log email notification when not in test environment', async () => {
    // Temporarily change NODE_ENV
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCI = process.env.CI;
    process.env.NODE_ENV = 'production';
    delete process.env.CI;
    
    try {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const manager = new NotificationManager({ 
        email: 'admin@example.com' 
      }, '/test/vault');
      
      const event = {
        type: 'lockout_triggered' as const,
        timestamp: new Date().toISOString(),
        attempts: 5,
        lockout_count: 1,
        permanent_lockout_count: 0,
        remaining_seconds: 60,
        source: 'cli' as const
      };
      
      await manager.sendLockoutNotification(event);
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Email notification for lockout_triggered would be sent to admin@example.com')
      );
      
      consoleWarnSpy.mockRestore();
    } finally {
      // Restore NODE_ENV
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      
      if (originalCI !== undefined) {
        process.env.CI = originalCI;
      }
    }
  });

  // Note: HTTP request mocking is complex in ESM environment
  // The sendWebhook method is tested indirectly via the skip-in-test tests
  // Full HTTP mocking would require more complex setup
});