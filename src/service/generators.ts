import { ServiceConfig } from './config.js';

export interface GeneratorContext {
  execPath: string;
  nodePath: string;
  workingDirectory: string;
  logFile: string;
  errorLogFile: string;
  config: ServiceConfig;
}

export function buildServeArgs(config: ServiceConfig): string[] {
  const args = ['serve'];
  args.push('--mode', config.server.mode);
  args.push('--port', String(config.server.port));
  args.push('--host', config.server.host);
  if (config.server.api_key) {
    args.push('--api-key', config.server.api_key);
  }
  return args;
}

export function generateSystemdUnit(ctx: GeneratorContext): string {
  const args = buildServeArgs(ctx.config).join(' ');
  const restart = ctx.config.restart_on_failure ? 'on-failure' : 'no';
  return `[Unit]
Description=EnvCP secure environment variable server
After=network.target

[Service]
Type=simple
WorkingDirectory=${ctx.workingDirectory}
ExecStart=${ctx.nodePath} ${ctx.execPath} ${args}
Restart=${restart}
RestartSec=5
StandardOutput=append:${ctx.logFile}
StandardError=append:${ctx.errorLogFile}
Environment=NODE_ENV=production
Environment=ENVCP_LOG_LEVEL=${ctx.config.log_level}

[Install]
WantedBy=default.target
`;
}

export function generateLaunchdPlist(ctx: GeneratorContext): string {
  const args = buildServeArgs(ctx.config);
  const programArgs = [ctx.nodePath, ctx.execPath, ...args]
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n');
  const keepAlive = ctx.config.restart_on_failure
    ? '<true/>'
    : '<false/>';
  const runAtLoad = ctx.config.autostart ? '<true/>' : '<false/>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.envcp</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(ctx.workingDirectory)}</string>
  <key>RunAtLoad</key>
  ${runAtLoad}
  <key>KeepAlive</key>
  ${keepAlive}
  <key>StandardOutPath</key>
  <string>${escapeXml(ctx.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(ctx.errorLogFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>ENVCP_LOG_LEVEL</key>
    <string>${escapeXml(ctx.config.log_level)}</string>
  </dict>
</dict>
</plist>
`;
}

export function generateWindowsWrapperScript(ctx: GeneratorContext): string {
  const args = buildServeArgs(ctx.config)
    .map((a) => (a.includes(' ') ? `"${a}"` : a))
    .join(' ');
  return `@echo off
set NODE_ENV=production
set ENVCP_LOG_LEVEL=${ctx.config.log_level}
cd /d "${ctx.workingDirectory}"
"${ctx.nodePath}" "${ctx.execPath}" ${args} >> "${ctx.logFile}" 2>> "${ctx.errorLogFile}"
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
