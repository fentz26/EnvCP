import * as os from 'os';
import * as path from 'path';

export type Platform = 'linux' | 'macos' | 'windows';

export function detectPlatform(): Platform {
  const p = os.platform();
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return 'linux';
}

export function getServiceName(): string {
  return 'envcp';
}

export function getUnitInstallPath(platform: Platform): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  switch (platform) {
    case 'linux':
      return path.join(home, '.config', 'systemd', 'user', 'envcp.service');
    case 'macos':
      return path.join(home, 'Library', 'LaunchAgents', 'com.envcp.plist');
    case 'windows':
      return path.join(home, '.envcp', 'envcp-service.bat');
  }
}
