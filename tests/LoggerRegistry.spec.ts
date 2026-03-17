import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getSharedLogger,
  finalizeSharedLogger,
  hasSharedLogger,
  removeSharedLogger,
} from '../src/LoggerRegistry';
import { ApiLogger } from '../src/ApiLogger';

function createTempLogDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
}

test.describe('LoggerRegistry', () => {
  test.beforeEach(() => {
    process.env.API_LOGS = 'true';
  });

  test.afterEach(() => {
    delete process.env.API_LOGS;
  });

  test('getSharedLogger should create a new logger on first call', () => {
    const logDir = createTempLogDir();
    const key = `test-create-${Date.now()}`;
    const logger = getSharedLogger(key, {
      testName: 'shared-test',
      logDirectory: logDir,
    });

    expect(logger).toBeInstanceOf(ApiLogger);
    expect(hasSharedLogger(key)).toBe(true);

    removeSharedLogger(key);
    fs.rmSync(logDir, { recursive: true });
  });

  test('getSharedLogger should return same instance on subsequent calls', () => {
    const logDir = createTempLogDir();
    const key = `test-same-${Date.now()}`;
    const logger1 = getSharedLogger(key, {
      testName: 'shared-test',
      logDirectory: logDir,
    });
    const logger2 = getSharedLogger(key);

    expect(logger1).toBe(logger2);

    removeSharedLogger(key);
    fs.rmSync(logDir, { recursive: true });
  });

  test('hasSharedLogger should return false for unknown keys', () => {
    expect(hasSharedLogger('non-existent-key')).toBe(false);
  });

  test('removeSharedLogger should remove logger without finalizing', () => {
    const logDir = createTempLogDir();
    const key = `test-remove-${Date.now()}`;
    getSharedLogger(key, {
      testName: 'remove-test',
      logDirectory: logDir,
    });
    expect(hasSharedLogger(key)).toBe(true);

    removeSharedLogger(key);
    expect(hasSharedLogger(key)).toBe(false);
    fs.rmSync(logDir, { recursive: true });
  });

  test('finalizeSharedLogger should write log and remove from registry', () => {
    const logDir = createTempLogDir();
    const key = `test-finalize-${Date.now()}`;
    const logger = getSharedLogger(key, {
      testName: 'finalize-test',
      logDirectory: logDir,
    });

    // Add some API calls
    logger.logApiCall('GET', 'https://api.example.com/test', undefined, undefined, 200, undefined, {}, 50);

    finalizeSharedLogger(key, 'PASSED');

    // Logger should be removed from registry
    expect(hasSharedLogger(key)).toBe(false);

    // Log file should be created
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    expect(files).toHaveLength(1);

    const data = JSON.parse(
      fs.readFileSync(path.join(logDir, files[0]), 'utf-8'),
    );
    expect(data.test.result).toBe('PASSED');
    expect(data.steps).toHaveLength(1);

    fs.rmSync(logDir, { recursive: true });
  });

  test('finalizeSharedLogger should handle non-existent key gracefully', () => {
    expect(() => {
      finalizeSharedLogger('non-existent', 'PASSED');
    }).not.toThrow();
  });

  test('shared logger should support context switching across phases', () => {
    const logDir = createTempLogDir();
    const key = `test-phases-${Date.now()}`;

    // Phase 1: beforeAll — preconditions
    const logger1 = getSharedLogger(key, {
      testName: 'phase-test',
      logDirectory: logDir,
    });
    logger1.setContext('preconditions');
    logger1.logApiCall('GET', 'url/setup', undefined, undefined, 200, undefined, {}, 30);

    // Phase 2: test — steps
    const logger2 = getSharedLogger(key);
    logger2.setContext('test');
    logger2.logApiCall('POST', 'url/action', undefined, undefined, 201, undefined, {}, 50);

    // Phase 3: afterAll — teardown
    const logger3 = getSharedLogger(key);
    logger3.setContext('teardown');
    logger3.logApiCall('DELETE', 'url/cleanup', undefined, undefined, 204, undefined, null, 20);

    // All three should be the same instance
    expect(logger1).toBe(logger2);
    expect(logger2).toBe(logger3);

    finalizeSharedLogger(key, 'PASSED');

    const data = JSON.parse(
      fs.readFileSync(
        path.join(
          logDir,
          fs.readdirSync(logDir).filter((f) => f.endsWith('.log'))[0],
        ),
        'utf-8',
      ),
    );
    expect(data.preconditions).toHaveLength(1);
    expect(data.steps).toHaveLength(1);
    expect(data.teardown).toHaveLength(1);
    expect(data.summary.totalRequests).toBe(3);

    fs.rmSync(logDir, { recursive: true });
  });
});
