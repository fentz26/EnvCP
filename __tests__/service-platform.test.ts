import { jest } from '@jest/globals';
import * as path from 'path';
import * as os from 'os';

const mockOsPlatform = jest.fn<() => NodeJS.Platform>();
const mockOsHomedir = jest.fn<() => string>();

jest.unstable_mockModule('os', () => ({
  __esModule: true,
  default: {
    platform: mockOsPlatform,
    homedir: mockOsHomedir,
  },
  platform: mockOsPlatform,
  homedir: mockOsHomedir,
}));

const { detectPlatform, getServiceName, getUnitInstallPath } = await import(
  '../src/service/platform.js'
);

describe('service/platform', () => {
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    mockOsPlatform.mockReset();
    mockOsHomedir.mockReset();
    mockOsHomedir.mockReturnValue(os.homedir());
    mockOsPlatform.mockReturnValue('linux');
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
  });

  describe('detectPlatform', () => {
    it('returns "macos" on darwin', () => {
      mockOsPlatform.mockReturnValue('darwin');
      expect(detectPlatform()).toBe('macos');
    });

    it('returns "windows" on win32', () => {
      mockOsPlatform.mockReturnValue('win32');
      expect(detectPlatform()).toBe('windows');
    });

    it('returns "linux" on linux', () => {
      mockOsPlatform.mockReturnValue('linux');
      expect(detectPlatform()).toBe('linux');
    });

    it('returns "linux" on exotic platforms', () => {
      mockOsPlatform.mockReturnValue('freebsd' as NodeJS.Platform);
      expect(detectPlatform()).toBe('linux');
    });
  });

  describe('getServiceName', () => {
    it('returns the fixed service name', () => {
      expect(getServiceName()).toBe('envcp');
    });
  });

  describe('getUnitInstallPath', () => {
    beforeEach(() => {
      process.env.HOME = '/home/tester';
      delete process.env.USERPROFILE;
    });

    it('places the systemd unit under ~/.config/systemd/user', () => {
      expect(getUnitInstallPath('linux')).toBe(
        path.join('/home/tester', '.config', 'systemd', 'user', 'envcp.service'),
      );
    });

    it('places the launchd plist under ~/Library/LaunchAgents', () => {
      expect(getUnitInstallPath('macos')).toBe(
        path.join('/home/tester', 'Library', 'LaunchAgents', 'com.envcp.plist'),
      );
    });

    it('places the windows batch wrapper under ~/.envcp', () => {
      expect(getUnitInstallPath('windows')).toBe(
        path.join('/home/tester', '.envcp', 'envcp-service.bat'),
      );
    });

    it('prefers USERPROFILE when HOME is absent', () => {
      delete process.env.HOME;
      process.env.USERPROFILE = '/Users/profile';
      expect(getUnitInstallPath('windows')).toBe(
        path.join('/Users/profile', '.envcp', 'envcp-service.bat'),
      );
    });

    it('falls back to os.homedir() when no env is set', () => {
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      mockOsHomedir.mockReturnValue('/fallback/home');
      expect(getUnitInstallPath('linux')).toBe(
        path.join('/fallback/home', '.config', 'systemd', 'user', 'envcp.service'),
      );
    });
  });
});
