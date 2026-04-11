import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

const mockRequest = jest.fn();

jest.unstable_mockModule('https', () => ({
  default: {
    request: mockRequest,
  },
  request: mockRequest,
}));

import { fetchLatestRelease } from '../src/utils/update-checker';

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
