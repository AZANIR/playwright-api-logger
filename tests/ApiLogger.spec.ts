import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ApiLogger, createApiLogger, createSetupLogger, createTeardownLogger } from '../src/ApiLogger';

// Helper: create a temp directory for test logs
function createTempLogDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'api-logger-test-'));
}

// Helper: read log file and parse JSON
function readLogFile(logDir: string): any {
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(logDir, files[0]), 'utf-8'));
}

test.describe('ApiLogger', () => {
  test.describe('when API_LOGS=true', () => {
    test.beforeEach(() => {
      process.env.API_LOGS = 'true';
    });

    test.afterEach(() => {
      delete process.env.API_LOGS;
    });

    test('should be enabled when API_LOGS=true', () => {
      const logger = new ApiLogger({ testName: 'test-enabled' });
      expect(logger.isEnabled()).toBe(true);
    });

    test('should create log file on finalize', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-finalize',
        logDirectory: logDir,
      });

      logger.logApiCall('GET', 'https://api.example.com/health', undefined, undefined, 200, undefined, { status: 'OK' }, 100);
      logger.finalize('PASSED');

      const data = readLogFile(logDir);
      expect(data).not.toBeNull();
      expect(data.test.name).toBe('test-finalize');
      expect(data.test.result).toBe('PASSED');
      expect(data.steps).toHaveLength(1);
      expect(data.summary.totalRequests).toBe(1);

      // Cleanup
      fs.rmSync(logDir, { recursive: true });
    });

    test('should log API calls to correct context sections', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-contexts',
        logDirectory: logDir,
      });

      // Preconditions
      logger.startPreconditions();
      logger.logApiCall('GET', 'https://api.example.com/setup', undefined, undefined, 200, undefined, {}, 50);

      // Test steps
      logger.startTest();
      logger.logApiCall('POST', 'https://api.example.com/action', undefined, { data: 'test' }, 201, undefined, {}, 100);
      logger.logApiCall('GET', 'https://api.example.com/verify', undefined, undefined, 200, undefined, {}, 75);

      // Teardown
      logger.startTeardown();
      logger.logApiCall('DELETE', 'https://api.example.com/cleanup', undefined, undefined, 204, undefined, null, 60);

      logger.finalize('PASSED');

      const data = readLogFile(logDir);
      expect(data.preconditions).toHaveLength(1);
      expect(data.preconditions[0].request.method).toBe('GET');
      expect(data.steps).toHaveLength(2);
      expect(data.steps[0].request.method).toBe('POST');
      expect(data.steps[1].request.method).toBe('GET');
      expect(data.teardown).toHaveLength(1);
      expect(data.teardown[0].request.method).toBe('DELETE');
      expect(data.summary.preconditions).toBe(1);
      expect(data.summary.testSteps).toBe(2);
      expect(data.summary.teardown).toBe(1);
      expect(data.summary.totalRequests).toBe(4);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should assign step numbers per section', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-step-numbers',
        logDirectory: logDir,
      });

      logger.startPreconditions();
      logger.logApiCall('GET', 'url1', undefined, undefined, 200, undefined, {}, 10);
      logger.logApiCall('GET', 'url2', undefined, undefined, 200, undefined, {}, 10);

      logger.startTest();
      logger.logApiCall('POST', 'url3', undefined, undefined, 201, undefined, {}, 20);

      logger.finalize('PASSED');

      const data = readLogFile(logDir);
      expect(data.preconditions[0].step).toBe(1);
      expect(data.preconditions[1].step).toBe(2);
      expect(data.steps[0].step).toBe(1);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should attach description to next API call', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-describe',
        logDirectory: logDir,
      });

      logger.describe('Get employee list');
      logger.logApiCall('GET', 'https://api.example.com/employees', undefined, undefined, 200, undefined, [], 150);

      // Second call without description
      logger.logApiCall('GET', 'https://api.example.com/other', undefined, undefined, 200, undefined, {}, 50);

      logger.finalize('PASSED');

      const data = readLogFile(logDir);
      expect(data.steps[0].description).toBe('Get employee list');
      expect(data.steps[1].description).toBeUndefined();

      fs.rmSync(logDir, { recursive: true });
    });

    test('should store titlePath and testFile', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-titlepath',
        testFile: 'tests/api/employees.spec.ts',
        titlePath: ['', 'GET /employees', 'should return 200'],
        logDirectory: logDir,
      });

      logger.finalize('PASSED');

      const data = readLogFile(logDir);
      expect(data.test.file).toBe('tests/api/employees.spec.ts');
      expect(data.test.titlePath).toEqual(['', 'GET /employees', 'should return 200']);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should calculate duration correctly', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-duration',
        logDirectory: logDir,
      });

      logger.logApiCall('GET', 'url', undefined, undefined, 200, undefined, {}, 100);
      logger.logApiCall('POST', 'url', undefined, undefined, 201, undefined, {}, 200);
      logger.finalize('PASSED');

      const data = readLogFile(logDir);
      expect(data.summary.totalDuration).toBe(300);
      expect(data.test.duration).toBeGreaterThanOrEqual(0);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should set result to FAILED', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-failed',
        logDirectory: logDir,
      });

      logger.finalize('FAILED');

      const data = readLogFile(logDir);
      expect(data.test.result).toBe('FAILED');

      fs.rmSync(logDir, { recursive: true });
    });

    test('should generate a sanitized filename', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'GET Without token (401) — special/chars',
        logDirectory: logDir,
      });

      logger.finalize('PASSED');

      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      expect(files).toHaveLength(1);
      // No special chars in filename (timestamp: 2026-03-17T12-34-04-338Z)
      expect(files[0]).toMatch(/^[a-z0-9-]+_\d{4}-\d{2}-\d{2}T[\d-]+Z?\.log$/);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should handle setContext method', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-setcontext',
        logDirectory: logDir,
      });

      logger.setContext('teardown');
      logger.logApiCall('DELETE', 'url', undefined, undefined, 204, undefined, null, 30);
      logger.finalize('PASSED');

      const data = readLogFile(logDir);
      expect(data.teardown).toHaveLength(1);
      expect(data.steps).toHaveLength(0);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should include curl in each step', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-curl',
        logDirectory: logDir,
      });

      logger.logApiCall('GET', 'https://api.example.com/health', { Accept: 'application/json' }, undefined, 200, undefined, {}, 50);
      logger.finalize('PASSED');

      const data = readLogFile(logDir);
      expect(data.steps[0].curl).toContain("curl -X GET 'https://api.example.com/health'");
      expect(data.steps[0].curl).toContain('Accept: application/json');

      fs.rmSync(logDir, { recursive: true });
    });

    test('should handle empty test (no API calls)', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-empty',
        logDirectory: logDir,
      });

      logger.finalize('SKIPPED');

      const data = readLogFile(logDir);
      expect(data.test.result).toBe('SKIPPED');
      expect(data.preconditions).toHaveLength(0);
      expect(data.steps).toHaveLength(0);
      expect(data.teardown).toHaveLength(0);
      expect(data.summary.totalRequests).toBe(0);

      fs.rmSync(logDir, { recursive: true });
    });
  });

  test.describe('when API_LOGS=false', () => {
    test.beforeEach(() => {
      process.env.API_LOGS = 'false';
    });

    test.afterEach(() => {
      delete process.env.API_LOGS;
    });

    test('should be disabled', () => {
      const logger = new ApiLogger({ testName: 'test-disabled' });
      expect(logger.isEnabled()).toBe(false);
    });

    test('should not create log files', () => {
      const logDir = createTempLogDir();
      const logger = new ApiLogger({
        testName: 'test-no-log',
        logDirectory: logDir,
      });

      logger.logApiCall('GET', 'url', undefined, undefined, 200, undefined, {}, 50);
      logger.finalize('PASSED');

      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      expect(files).toHaveLength(0);

      fs.rmSync(logDir, { recursive: true });
    });

    test('should not throw when logging', () => {
      const logger = new ApiLogger({ testName: 'test-safe' });
      expect(() => {
        logger.logApiCall('GET', 'url', undefined, undefined, 200, undefined, {}, 50);
        logger.finalize('PASSED');
      }).not.toThrow();
    });
  });

  test.describe('factory functions', () => {
    test.beforeEach(() => {
      process.env.API_LOGS = 'true';
    });

    test.afterEach(() => {
      delete process.env.API_LOGS;
    });

    test('createApiLogger creates logger with test context', () => {
      const logger = createApiLogger('my-test');
      expect(logger.isEnabled()).toBe(true);
    });

    test('createSetupLogger creates logger with preconditions context', () => {
      const logger = createSetupLogger('setup-test');
      expect(logger.isEnabled()).toBe(true);
    });

    test('createTeardownLogger creates logger with teardown context', () => {
      const logger = createTeardownLogger('teardown-test');
      expect(logger.isEnabled()).toBe(true);
    });
  });
});
