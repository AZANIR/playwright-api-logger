import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ApiLoggerReporter from '../src/reporter';
import { TestLogDocument } from '../src/types';

function createTempLogDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-test-'));
}

// Helper: create a raw log file that simulates ApiLogger output
function writeRawLog(
  logDir: string,
  filename: string,
  overrides: Partial<TestLogDocument> & { test: TestLogDocument['test'] },
): void {
  const doc: TestLogDocument = {
    test: overrides.test,
    preconditions: overrides.preconditions || [],
    steps: overrides.steps || [],
    teardown: overrides.teardown || [],
    summary: overrides.summary || {
      totalRequests: 0,
      preconditions: 0,
      testSteps: 0,
      teardown: 0,
      totalDuration: 0,
    },
  };
  fs.writeFileSync(path.join(logDir, filename), JSON.stringify(doc, null, 2));
}

test.describe('ApiLoggerReporter', () => {
  test.describe('onBegin', () => {
    test('should create log directory if it does not exist', () => {
      const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-parent-'));
      const logDir = path.join(parentDir, 'logs');
      const reporter = new ApiLoggerReporter({ logDirectory: logDir });

      expect(fs.existsSync(logDir)).toBe(false);
      reporter.onBegin({} as any, {} as any);
      expect(fs.existsSync(logDir)).toBe(true);

      fs.rmSync(parentDir, { recursive: true });
    });

    test('should not throw if directory already exists', () => {
      const logDir = createTempLogDir();
      const reporter = new ApiLoggerReporter({ logDirectory: logDir });

      expect(() => reporter.onBegin({} as any, {} as any)).not.toThrow();

      fs.rmSync(logDir, { recursive: true });
    });
  });

  test.describe('onEnd — merge', () => {
    test('should merge 3 related files into one (beforeAll + test + afterAll)', () => {
      const logDir = createTempLogDir();

      // File 1: beforeAll (earliest timestamp)
      writeRawLog(logDir, 'beforeall_2026-03-17T10-00-00.log', {
        test: {
          name: 'beforeAll hook',
          file: 'tests/api/users.spec.ts',
          titlePath: ['', 'GET /users', 'beforeAll hook'],
          startedAt: '2026-03-17T10:00:00.000Z',
          finishedAt: '2026-03-17T10:00:01.000Z',
          result: 'PASSED',
        },
        steps: [
          {
            step: 1,
            description: 'Setup test data',
            timestamp: '2026-03-17T10:00:00.500Z',
            request: { method: 'POST', url: 'https://api.example.com/setup' },
            response: { status: 201 },
            duration: 100,
            curl: "curl -X POST 'url'",
          },
        ],
        summary: { totalRequests: 1, preconditions: 0, testSteps: 1, teardown: 0, totalDuration: 100 },
      });

      // File 2: test (middle timestamp)
      writeRawLog(logDir, 'test_2026-03-17T10-00-02.log', {
        test: {
          name: 'should return 200',
          file: 'tests/api/users.spec.ts',
          titlePath: ['', 'GET /users', 'should return 200'],
          startedAt: '2026-03-17T10:00:02.000Z',
          finishedAt: '2026-03-17T10:00:03.000Z',
          result: 'PASSED',
        },
        steps: [
          {
            step: 1,
            description: 'Get users list',
            timestamp: '2026-03-17T10:00:02.500Z',
            request: { method: 'GET', url: 'https://api.example.com/users' },
            response: { status: 200 },
            duration: 150,
            curl: "curl -X GET 'url'",
          },
        ],
        summary: { totalRequests: 1, preconditions: 0, testSteps: 1, teardown: 0, totalDuration: 150 },
      });

      // File 3: afterAll (latest timestamp)
      writeRawLog(logDir, 'afterall_2026-03-17T10-00-04.log', {
        test: {
          name: 'afterAll hook',
          file: 'tests/api/users.spec.ts',
          titlePath: ['', 'GET /users', 'afterAll hook'],
          startedAt: '2026-03-17T10:00:04.000Z',
          finishedAt: '2026-03-17T10:00:05.000Z',
          result: 'PASSED',
        },
        steps: [
          {
            step: 1,
            description: 'Cleanup',
            timestamp: '2026-03-17T10:00:04.500Z',
            request: { method: 'DELETE', url: 'https://api.example.com/cleanup' },
            response: { status: 204 },
            duration: 80,
            curl: "curl -X DELETE 'url'",
          },
        ],
        summary: { totalRequests: 1, preconditions: 0, testSteps: 1, teardown: 0, totalDuration: 80 },
      });

      const reporter = new ApiLoggerReporter({
        logDirectory: logDir,
        printSummary: false,
      });
      reporter.onEnd({} as any);

      // Should have 1 merged file instead of 3
      const remainingFiles = fs
        .readdirSync(logDir)
        .filter((f) => f.endsWith('.log'));
      expect(remainingFiles).toHaveLength(1);

      const merged = JSON.parse(
        fs.readFileSync(path.join(logDir, remainingFiles[0]), 'utf-8'),
      ) as TestLogDocument;

      // First file's steps → preconditions
      expect(merged.preconditions).toHaveLength(1);
      expect(merged.preconditions[0].description).toBe('Setup test data');
      expect(merged.preconditions[0].step).toBe(1);

      // Middle file's steps → steps
      expect(merged.steps).toHaveLength(1);
      expect(merged.steps[0].description).toBe('Get users list');
      expect(merged.steps[0].step).toBe(1);

      // Last file's steps → teardown
      expect(merged.teardown).toHaveLength(1);
      expect(merged.teardown[0].description).toBe('Cleanup');
      expect(merged.teardown[0].step).toBe(1);

      // Summary
      expect(merged.summary.totalRequests).toBe(3);
      expect(merged.summary.preconditions).toBe(1);
      expect(merged.summary.testSteps).toBe(1);
      expect(merged.summary.teardown).toBe(1);
      expect(merged.summary.totalDuration).toBe(330);

      // Test metadata
      expect(merged.test.startedAt).toBe('2026-03-17T10:00:00.000Z');
      expect(merged.test.finishedAt).toBe('2026-03-17T10:00:05.000Z');
      expect(merged.test.result).toBe('PASSED');

      fs.rmSync(logDir, { recursive: true });
    });

    test('should merge 2 files (preconditions + test, no teardown)', () => {
      const logDir = createTempLogDir();

      writeRawLog(logDir, 'setup_2026-03-17T10-00-00.log', {
        test: {
          name: 'setup',
          file: 'tests/api/orders.spec.ts',
          titlePath: ['', 'POST /orders', 'setup'],
          startedAt: '2026-03-17T10:00:00.000Z',
          result: 'PASSED',
        },
        steps: [
          {
            step: 1,
            timestamp: '2026-03-17T10:00:00.500Z',
            request: { method: 'POST', url: 'url/setup' },
            response: { status: 201 },
            duration: 50,
            curl: "curl 'url'",
          },
        ],
        summary: { totalRequests: 1, preconditions: 0, testSteps: 1, teardown: 0, totalDuration: 50 },
      });

      writeRawLog(logDir, 'test_2026-03-17T10-00-01.log', {
        test: {
          name: 'should create order',
          file: 'tests/api/orders.spec.ts',
          titlePath: ['', 'POST /orders', 'should create order'],
          startedAt: '2026-03-17T10:00:01.000Z',
          result: 'PASSED',
        },
        steps: [
          {
            step: 1,
            timestamp: '2026-03-17T10:00:01.500Z',
            request: { method: 'POST', url: 'url/orders' },
            response: { status: 201 },
            duration: 100,
            curl: "curl 'url'",
          },
        ],
        summary: { totalRequests: 1, preconditions: 0, testSteps: 1, teardown: 0, totalDuration: 100 },
      });

      const reporter = new ApiLoggerReporter({
        logDirectory: logDir,
        printSummary: false,
      });
      reporter.onEnd({} as any);

      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      expect(files).toHaveLength(1);

      const merged = JSON.parse(
        fs.readFileSync(path.join(logDir, files[0]), 'utf-8'),
      ) as TestLogDocument;

      expect(merged.preconditions).toHaveLength(1);
      expect(merged.steps).toHaveLength(1);
      expect(merged.teardown).toHaveLength(0);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should NOT merge standalone tests (titlePath < 3 elements)', () => {
      const logDir = createTempLogDir();

      writeRawLog(logDir, 'standalone1.log', {
        test: {
          name: 'health check',
          file: 'tests/health.spec.ts',
          titlePath: ['', 'health check'],
          startedAt: '2026-03-17T10:00:00.000Z',
          result: 'PASSED',
        },
        steps: [
          {
            step: 1,
            timestamp: '2026-03-17T10:00:00.500Z',
            request: { method: 'GET', url: 'url/health' },
            response: { status: 200 },
            duration: 50,
            curl: "curl 'url'",
          },
        ],
        summary: { totalRequests: 1, preconditions: 0, testSteps: 1, teardown: 0, totalDuration: 50 },
      });

      writeRawLog(logDir, 'standalone2.log', {
        test: {
          name: 'version check',
          file: 'tests/health.spec.ts',
          titlePath: ['', 'version check'],
          startedAt: '2026-03-17T10:00:01.000Z',
          result: 'PASSED',
        },
        steps: [
          {
            step: 1,
            timestamp: '2026-03-17T10:00:01.500Z',
            request: { method: 'GET', url: 'url/version' },
            response: { status: 200 },
            duration: 30,
            curl: "curl 'url'",
          },
        ],
        summary: { totalRequests: 1, preconditions: 0, testSteps: 1, teardown: 0, totalDuration: 30 },
      });

      const reporter = new ApiLoggerReporter({
        logDirectory: logDir,
        printSummary: false,
      });
      reporter.onEnd({} as any);

      // Both files should remain — not merged
      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      expect(files).toHaveLength(2);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should NOT merge files from different describe blocks', () => {
      const logDir = createTempLogDir();

      writeRawLog(logDir, 'suite-a.log', {
        test: {
          name: 'test A',
          file: 'tests/api/users.spec.ts',
          titlePath: ['', 'Suite A', 'test A'],
          startedAt: '2026-03-17T10:00:00.000Z',
          result: 'PASSED',
        },
      });

      writeRawLog(logDir, 'suite-b.log', {
        test: {
          name: 'test B',
          file: 'tests/api/users.spec.ts',
          titlePath: ['', 'Suite B', 'test B'],
          startedAt: '2026-03-17T10:00:01.000Z',
          result: 'PASSED',
        },
      });

      const reporter = new ApiLoggerReporter({
        logDirectory: logDir,
        printSummary: false,
      });
      reporter.onEnd({} as any);

      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      expect(files).toHaveLength(2);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should use FAILED result if any file in group has FAILED', () => {
      const logDir = createTempLogDir();

      writeRawLog(logDir, 'setup.log', {
        test: {
          name: 'setup',
          file: 'tests/api.spec.ts',
          titlePath: ['', 'Suite', 'setup'],
          startedAt: '2026-03-17T10:00:00.000Z',
          result: 'PASSED',
        },
      });

      writeRawLog(logDir, 'test.log', {
        test: {
          name: 'test',
          file: 'tests/api.spec.ts',
          titlePath: ['', 'Suite', 'test'],
          startedAt: '2026-03-17T10:00:01.000Z',
          result: 'FAILED',
        },
      });

      writeRawLog(logDir, 'teardown.log', {
        test: {
          name: 'teardown',
          file: 'tests/api.spec.ts',
          titlePath: ['', 'Suite', 'teardown'],
          startedAt: '2026-03-17T10:00:02.000Z',
          result: 'PASSED',
        },
      });

      const reporter = new ApiLoggerReporter({
        logDirectory: logDir,
        printSummary: false,
      });
      reporter.onEnd({} as any);

      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      const merged = JSON.parse(
        fs.readFileSync(path.join(logDir, files[0]), 'utf-8'),
      );
      expect(merged.test.result).toBe('FAILED');

      fs.rmSync(logDir, { recursive: true });
    });

    test('should skip malformed log files gracefully', () => {
      const logDir = createTempLogDir();

      // Write invalid JSON
      fs.writeFileSync(path.join(logDir, 'bad.log'), 'not json');

      // Write valid file
      writeRawLog(logDir, 'good.log', {
        test: {
          name: 'good test',
          startedAt: '2026-03-17T10:00:00.000Z',
          result: 'PASSED',
        },
      });

      const reporter = new ApiLoggerReporter({
        logDirectory: logDir,
        printSummary: false,
      });

      expect(() => reporter.onEnd({} as any)).not.toThrow();

      fs.rmSync(logDir, { recursive: true });
    });

    test('should handle empty log directory', () => {
      const logDir = createTempLogDir();
      const reporter = new ApiLoggerReporter({
        logDirectory: logDir,
        printSummary: false,
      });

      expect(() => reporter.onEnd({} as any)).not.toThrow();

      fs.rmSync(logDir, { recursive: true });
    });

    test('should handle non-existent log directory', () => {
      const reporter = new ApiLoggerReporter({
        logDirectory: '/tmp/non-existent-dir-' + Date.now(),
        printSummary: false,
      });

      expect(() => reporter.onEnd({} as any)).not.toThrow();
    });
  });

  test.describe('merge=false', () => {
    test('should not merge files when merge option is false', () => {
      const logDir = createTempLogDir();

      writeRawLog(logDir, 'file1.log', {
        test: {
          name: 'test1',
          file: 'tests/suite.spec.ts',
          titlePath: ['', 'Suite', 'test1'],
          startedAt: '2026-03-17T10:00:00.000Z',
          result: 'PASSED',
        },
      });

      writeRawLog(logDir, 'file2.log', {
        test: {
          name: 'test2',
          file: 'tests/suite.spec.ts',
          titlePath: ['', 'Suite', 'test2'],
          startedAt: '2026-03-17T10:00:01.000Z',
          result: 'PASSED',
        },
      });

      const reporter = new ApiLoggerReporter({
        logDirectory: logDir,
        merge: false,
        printSummary: false,
      });
      reporter.onEnd({} as any);

      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      expect(files).toHaveLength(2);

      fs.rmSync(logDir, { recursive: true });
    });
  });
});
