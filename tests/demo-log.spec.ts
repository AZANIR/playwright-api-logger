/**
 * Demo log test — writes API logs to ./logs/ for inspection.
 * Run: API_LOGS=true npx playwright test tests/demo-log.spec.ts
 * Or: npm run test:demo
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { withApiLogging } from '../src/withApiLogging';

function createMockRequest() {
  const mockResponse = (status: number, body: unknown, url: string) => ({
    status: () => status,
    url: () => url,
    headers: () => ({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  return {
    get: async (url: string) => mockResponse(200, { items: [{ id: '1', name: 'Demo' }] }, url),
    post: async (url: string, _opts?: unknown) =>
      mockResponse(201, { id: 'new-id', created: true }, url),
    dispose: async () => {},
  } as any;
}

test.describe('Demo log test', () => {
  test.skip(
    () => process.env.API_LOGS !== 'true',
    'Run with npm run test:demo',
  );

  test.beforeEach(() => {
    process.env.API_LOGS = 'true';
  });

  test.afterEach(() => {
    delete process.env.API_LOGS;
  });

  test('writes API log to logs/ directory', async () => {
    const logDir = path.join(process.cwd(), 'logs');
    const request = createMockRequest();

    const logged = withApiLogging(request, {
      testName: 'Demo API calls',
      testFile: 'tests/demo-log.spec.ts',
      titlePath: ['', 'Demo log test', 'writes API log to logs/ directory'],
      logDirectory: logDir,
    });

    await logged.get('https://api.example.com/users');
    logged.__logger.describe('Create user');
    await logged.post('https://api.example.com/users', { data: { name: 'Test' } });
    logged.__logger.finalize('PASSED');

    expect(logged.__logger.isEnabled()).toBe(true);
    // Log file is in logs/ — check it exists
    const fs = await import('fs');
    const files = fs.readdirSync(logDir).filter((f: string) => f.endsWith('.log'));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
});
