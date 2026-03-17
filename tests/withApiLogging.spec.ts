import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { withApiLogging } from '../src/withApiLogging';
import { ApiLogger } from '../src/ApiLogger';

// Helper: create a temp directory for test logs
function createTempLogDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'api-logging-test-'));
}

// Helper: read first log file from directory
function readLogFile(logDir: string): any {
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(logDir, files[0]), 'utf-8'));
}

// Mock APIRequestContext — minimal implementation for testing proxy
function createMockRequest() {
  const responses = new Map<string, any>();

  const mockResponse = (status: number, body: any, url: string) => ({
    status: () => status,
    url: () => url,
    headers: () => ({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  const mock: any = {
    get: async (url: string, options?: any) => {
      return mockResponse(200, { data: 'get-result' }, url);
    },
    post: async (url: string, options?: any) => {
      return mockResponse(201, { id: 'new-id' }, url);
    },
    put: async (url: string, options?: any) => {
      return mockResponse(200, { updated: true }, url);
    },
    patch: async (url: string, options?: any) => {
      return mockResponse(200, { patched: true }, url);
    },
    delete: async (url: string, options?: any) => {
      return mockResponse(204, null, url);
    },
    head: async (url: string, options?: any) => {
      return mockResponse(200, null, url);
    },
    fetch: async (url: string, options?: any) => {
      return mockResponse(200, { fetched: true }, url);
    },
    dispose: async () => {},
  };

  return mock;
}

test.describe('withApiLogging', () => {
  test.beforeEach(() => {
    process.env.API_LOGS = 'true';
  });

  test.afterEach(() => {
    delete process.env.API_LOGS;
  });

  test('should return a proxied request with __logger', () => {
    const request = createMockRequest();
    const logged = withApiLogging(request, {
      testName: 'test-proxy',
    });

    expect(logged.__logger).toBeDefined();
    expect(logged.__logger).toBeInstanceOf(ApiLogger);
  });

  test('should intercept GET calls and log them', async () => {
    const logDir = createTempLogDir();
    const request = createMockRequest();
    const logged = withApiLogging(request, {
      testName: 'test-get',
      logDirectory: logDir,
    });

    await logged.get('https://api.example.com/users');
    logged.__logger.finalize('PASSED');

    const data = readLogFile(logDir);
    expect(data).not.toBeNull();
    expect(data.steps).toHaveLength(1);
    expect(data.steps[0].request.method).toBe('GET');
    expect(data.steps[0].request.url).toBe('https://api.example.com/users');
    expect(data.steps[0].response.status).toBe(200);
    expect(data.steps[0].curl).toContain("curl -X GET");

    fs.rmSync(logDir, { recursive: true });
  });

  test('should intercept POST calls and log them', async () => {
    const logDir = createTempLogDir();
    const request = createMockRequest();
    const logged = withApiLogging(request, {
      testName: 'test-post',
      logDirectory: logDir,
    });

    await logged.post('https://api.example.com/users', {
      data: { name: 'John' },
    });
    logged.__logger.finalize('PASSED');

    const data = readLogFile(logDir);
    expect(data.steps).toHaveLength(1);
    expect(data.steps[0].request.method).toBe('POST');
    expect(data.steps[0].response.status).toBe(201);

    fs.rmSync(logDir, { recursive: true });
  });

  test('should intercept PUT, PATCH, DELETE, HEAD calls', async () => {
    const logDir = createTempLogDir();
    const request = createMockRequest();
    const logged = withApiLogging(request, {
      testName: 'test-all-methods',
      logDirectory: logDir,
    });

    await logged.put('https://api.example.com/users/1', { data: {} });
    await logged.patch('https://api.example.com/users/1', { data: {} });
    await logged.delete('https://api.example.com/users/1');
    await logged.head('https://api.example.com/health');

    logged.__logger.finalize('PASSED');

    const data = readLogFile(logDir);
    expect(data.steps).toHaveLength(4);
    expect(data.steps[0].request.method).toBe('PUT');
    expect(data.steps[1].request.method).toBe('PATCH');
    expect(data.steps[2].request.method).toBe('DELETE');
    expect(data.steps[3].request.method).toBe('HEAD');

    fs.rmSync(logDir, { recursive: true });
  });

  test('should pass through non-HTTP methods unchanged', async () => {
    const request = createMockRequest();
    const logged = withApiLogging(request, { testName: 'test-passthrough' });

    // dispose() is not an HTTP method, should pass through
    await expect(logged.dispose()).resolves.toBeUndefined();
  });

  test('should extract testInfo properties when given TestInfo-like object', () => {
    const logDir = createTempLogDir();
    const request = createMockRequest();

    // Mock TestInfo
    const mockTestInfo = {
      title: 'GET users returns 200',
      file: 'tests/api/users.spec.ts',
      titlePath: ['', 'Users API', 'GET users returns 200'],
      status: 'passed',
    };

    const logged = withApiLogging(request, mockTestInfo as any);
    expect(logged.__logger).toBeDefined();
    expect(logged.__logger.isEnabled()).toBe(true);

    fs.rmSync(logDir, { recursive: true, force: true });
  });

  test('should accept options with custom context', async () => {
    const logDir = createTempLogDir();
    const request = createMockRequest();
    const logged = withApiLogging(request, {
      testName: 'test-context',
      logDirectory: logDir,
      context: 'preconditions',
    });

    await logged.get('https://api.example.com/setup');
    logged.__logger.finalize('PASSED');

    const data = readLogFile(logDir);
    expect(data.preconditions).toHaveLength(1);
    expect(data.steps).toHaveLength(0);

    fs.rmSync(logDir, { recursive: true });
  });

  test('should accept an existing logger instance', async () => {
    const logDir = createTempLogDir();
    const existingLogger = new ApiLogger({
      testName: 'existing-logger',
      logDirectory: logDir,
    });

    const request = createMockRequest();
    const logged = withApiLogging(request, {
      logger: existingLogger,
    });

    expect(logged.__logger).toBe(existingLogger);

    await logged.get('https://api.example.com/test');
    logged.__logger.finalize('PASSED');

    const data = readLogFile(logDir);
    expect(data.steps).toHaveLength(1);

    fs.rmSync(logDir, { recursive: true });
  });

  test('should log duration for each call', async () => {
    const logDir = createTempLogDir();
    const request = createMockRequest();
    const logged = withApiLogging(request, {
      testName: 'test-duration',
      logDirectory: logDir,
    });

    await logged.get('https://api.example.com/slow');
    logged.__logger.finalize('PASSED');

    const data = readLogFile(logDir);
    expect(data.steps[0].duration).toBeGreaterThanOrEqual(0);
    expect(typeof data.steps[0].duration).toBe('number');

    fs.rmSync(logDir, { recursive: true });
  });

  test('should handle API call errors gracefully', async () => {
    const logDir = createTempLogDir();
    const request = createMockRequest();
    // Override get to throw
    request.get = async () => {
      throw new Error('Network error');
    };

    const logged = withApiLogging(request, {
      testName: 'test-error',
      logDirectory: logDir,
    });

    await expect(logged.get('https://api.example.com/fail')).rejects.toThrow(
      'Network error',
    );

    logged.__logger.finalize('FAILED');

    const data = readLogFile(logDir);
    expect(data.steps).toHaveLength(1);
    expect(data.steps[0].response.status).toBe(0);
    expect(data.steps[0].response.body.error).toContain('Network error');

    fs.rmSync(logDir, { recursive: true });
  });

  test('should work when API_LOGS=false (disabled)', async () => {
    process.env.API_LOGS = 'false';
    const logDir = createTempLogDir();
    const request = createMockRequest();
    const logged = withApiLogging(request, {
      testName: 'test-disabled',
      logDirectory: logDir,
    });

    expect(logged.__logger.isEnabled()).toBe(false);

    // Should still proxy the request and return response
    const response = await logged.get('https://api.example.com/users');
    expect(response.status()).toBe(200);

    logged.__logger.finalize('PASSED');

    // No log files created
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    expect(files).toHaveLength(0);

    fs.rmSync(logDir, { recursive: true });
  });

  test('should store titlePath in options', async () => {
    const logDir = createTempLogDir();
    const request = createMockRequest();
    const logged = withApiLogging(request, {
      testName: 'test-titlepath-option',
      titlePath: ['Project', 'Suite', 'Test Name'],
      logDirectory: logDir,
    });

    await logged.get('https://api.example.com/test');
    logged.__logger.finalize('PASSED');

    const data = readLogFile(logDir);
    expect(data.test.titlePath).toEqual(['Project', 'Suite', 'Test Name']);

    fs.rmSync(logDir, { recursive: true });
  });
});
