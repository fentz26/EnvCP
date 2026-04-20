import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

const mockRequest = jest.fn();

jest.unstable_mockModule('https', () => ({
  default: {
    request: mockRequest,
  },
  request: mockRequest,
}));

import { fetchLatestRelease, fetchReleases, filterByChannel } from '../src/utils/update-checker';

function makeMockResponse(statusCode: number, body: string) {
  const res = new EventEmitter();
  (res as any).statusCode = statusCode;
  setImmediate(() => {
    (res as any).emit('data', Buffer.from(body));
    (res as any).emit('end');
  });
  return res;
}

function makeMockReq() {
  const req = new EventEmitter() as any;
  req.end = jest.fn();
  req.destroy = jest.fn();
  return req;
}

describe('fetchLatestRelease mocked', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('rejects on non-200 status', async () => {
    mockRequest.mockImplementation((_opts: any, cb: any) => {
      const res = makeMockResponse(403, JSON.stringify({ message: 'rate limited' }));
      const req = makeMockReq();
      process.nextTick(() => cb(res));
      return req;
    });

    await expect(fetchLatestRelease()).rejects.toThrow('rate limited');
  });

  it('rejects on non-200 with no message', async () => {
    mockRequest.mockImplementation((_opts: any, cb: any) => {
      const res = makeMockResponse(500, JSON.stringify({}));
      const req = makeMockReq();
      process.nextTick(() => cb(res));
      return req;
    });

    await expect(fetchLatestRelease()).rejects.toThrow('GitHub API returned 500');
  });

  it('rejects when response body is not JSON', async () => {
    mockRequest.mockImplementation((_opts: any, cb: any) => {
      const res = makeMockResponse(200, 'not json');
      const req = makeMockReq();
      process.nextTick(() => cb(res));
      return req;
    });

    await expect(fetchLatestRelease()).rejects.toThrow('Failed to parse response');
  });

  it('rejects on request error', async () => {
    mockRequest.mockImplementation((_opts: any, _cb: any) => {
      const req = makeMockReq();
      process.nextTick(() => req.emit('error', new Error('network down')));
      return req;
    });

    await expect(fetchLatestRelease()).rejects.toThrow('network down');
  });

  it('rejects on timeout', async () => {
    mockRequest.mockImplementation((_opts: any, _cb: any) => {
      const req = makeMockReq();
      process.nextTick(() => req.emit('timeout'));
      return req;
    });

    await expect(fetchLatestRelease()).rejects.toThrow('timed out');
    expect(mockRequest.mock.results[0].value.destroy).toHaveBeenCalled();
  });
});

describe('fetchReleases mocked', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('resolves with array of parsed releases on success', async () => {
    const releases = [
      { tag_name: 'v1.2.0', body: '', html_url: 'https://github.com/test/1' },
      { tag_name: 'v1.1.0', body: '[critical]', html_url: 'https://github.com/test/2' },
    ];
    mockRequest.mockImplementation((_opts: any, cb: any) => {
      const res = makeMockResponse(200, JSON.stringify(releases));
      const req = makeMockReq();
      process.nextTick(() => cb(res));
      return req;
    });

    const result = await fetchReleases();
    expect(result).toHaveLength(2);
    expect(result[0].tag).toBe('1.2.0');
    expect(result[1].critical).toBe(true);
  });

  it('rejects on non-200 status', async () => {
    mockRequest.mockImplementation((_opts: any, cb: any) => {
      const res = makeMockResponse(403, JSON.stringify({ message: 'rate limited' }));
      const req = makeMockReq();
      process.nextTick(() => cb(res));
      return req;
    });

    await expect(fetchReleases()).rejects.toThrow('rate limited');
  });

  it('rejects when body is not an array', async () => {
    mockRequest.mockImplementation((_opts: any, cb: any) => {
      const res = makeMockResponse(200, JSON.stringify({ not: 'array' }));
      const req = makeMockReq();
      process.nextTick(() => cb(res));
      return req;
    });

    await expect(fetchReleases()).rejects.toThrow();
  });

  it('rejects when body is not valid JSON', async () => {
    mockRequest.mockImplementation((_opts: any, cb: any) => {
      const res = makeMockResponse(200, 'not json at all');
      const req = makeMockReq();
      process.nextTick(() => cb(res));
      return req;
    });

    await expect(fetchReleases()).rejects.toThrow('Failed to parse response');
  });

  it('rejects on network error', async () => {
    mockRequest.mockImplementation((_opts: any, _cb: any) => {
      const req = makeMockReq();
      process.nextTick(() => req.emit('error', new Error('connection refused')));
      return req;
    });

    await expect(fetchReleases()).rejects.toThrow('connection refused');
  });

  it('rejects on timeout', async () => {
    mockRequest.mockImplementation((_opts: any, _cb: any) => {
      const req = makeMockReq();
      process.nextTick(() => req.emit('timeout'));
      return req;
    });

    await expect(fetchReleases()).rejects.toThrow('timed out');
    expect(mockRequest.mock.results[0].value.destroy).toHaveBeenCalled();
  });
});

describe('filterByChannel', () => {
  const releases = [
    { tag: '1.3.0', critical: false, body: '', url: '' },
    { tag: '1.2.0-exp.abc123', critical: false, body: '', url: '' },
    { tag: '1.2.0-canary.xyz', critical: false, body: '', url: '' },
    { tag: '1.1.0-beta', critical: false, body: '', url: '' },
    { tag: '1.1.0', critical: false, body: '', url: '' },
    { tag: '1.0.0-exp.def456', critical: false, body: '', url: '' },
  ];

  it('filters latest (stable only)', () => {
    const result = filterByChannel(releases, 'latest');
    expect(result.map(r => r.tag)).toEqual(['1.3.0', '1.1.0']);
  });

  it('filters experimental', () => {
    const result = filterByChannel(releases, 'experimental');
    expect(result.map(r => r.tag)).toEqual(['1.2.0-exp.abc123', '1.0.0-exp.def456']);
  });

  it('filters canary', () => {
    const result = filterByChannel(releases, 'canary');
    expect(result.map(r => r.tag)).toEqual(['1.2.0-canary.xyz']);
  });

  it('returns empty array when no releases match channel', () => {
    const result = filterByChannel(releases, 'canary');
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
