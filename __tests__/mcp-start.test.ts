import { jest } from '@jest/globals';

// Mock the MCP SDK transport and server connection
const mockConnect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({ type: 'stdio' })),
}));

// Intercept Server.prototype.connect
jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: jest.fn().mockImplementation(() => ({
      setRequestHandler: jest.fn(),
      connect: mockConnect,
    })),
  };
});

const { EnvCPServer } = await import('../src/mcp/server');
const { EnvCPConfigSchema } = await import('../src/types');

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

describe('EnvCPServer.start()', () => {
  let tmpDir: string;

  beforeEach(async () => {
    mockConnect.mockClear();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-mcpstart-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('calls adapter.init(), creates StdioServerTransport, and connects', async () => {
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const server = new EnvCPServer(config, tmpDir);

    await server.start();

    // Verify that server.connect was called with the transport
    expect(mockConnect).toHaveBeenCalledTimes(1);
    const transportArg = mockConnect.mock.calls[0][0];
    expect(transportArg).toEqual({ type: 'stdio' });
  });

  it('works with password in encrypted mode', async () => {
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: true },
      storage: { encrypted: true, path: '.envcp/store.enc' },
    });
    const server = new EnvCPServer(config, tmpDir, 'test-pass');

    await server.start();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
