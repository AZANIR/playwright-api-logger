/**
 * Global registry for sharing ApiLogger instances across
 * beforeAll / test / afterAll in a Playwright test.describe block.
 *
 * Solves the problem: Playwright creates separate fixture instances
 * for beforeAll, each test(), and afterAll — without a shared store
 * each gets its own logger and writes a separate file.
 *
 * With LoggerRegistry, all phases write to the SAME structured log.
 */

import { ApiLogger } from './ApiLogger';
import { LoggerConfig } from './types';

const registry = new Map<string, ApiLogger>();

/**
 * Get or create a shared logger by key.
 * First call creates the logger, subsequent calls return the same instance.
 *
 * @param key - Unique key for the logger (e.g. describe block name)
 * @param config - Logger config (only used on first call when creating)
 * @returns Shared ApiLogger instance
 *
 * @example
 * test.describe('GET /api/v1/employees', () => {
 *   const LOG_KEY = 'get-employees';
 *
 *   test.beforeAll(async ({ apiClient }) => {
 *     const logger = getSharedLogger(LOG_KEY, { testName: 'GET employees' });
 *     logger.startPreconditions();
 *     // ... apiClient calls logged to preconditions
 *   });
 *
 *   test('should return 200', async ({ apiClient }) => {
 *     const logger = getSharedLogger(LOG_KEY);
 *     logger.startTest();
 *     // ... apiClient calls logged to steps
 *   });
 *
 *   test.afterAll(() => {
 *     finalizeSharedLogger(LOG_KEY, 'PASSED');
 *   });
 * });
 */
export function getSharedLogger(key: string, config?: LoggerConfig): ApiLogger {
  if (!registry.has(key)) {
    registry.set(key, new ApiLogger(config));
  }
  return registry.get(key)!;
}

/**
 * Finalize a shared logger: write the structured document and remove from registry.
 *
 * @param key - The logger key used in getSharedLogger()
 * @param result - Test result: 'PASSED' | 'FAILED' | 'SKIPPED'
 * @param additionalInfo - Optional extra info to include
 */
export function finalizeSharedLogger(
  key: string,
  result: 'PASSED' | 'FAILED' | 'SKIPPED',
  additionalInfo?: Record<string, any>,
): void {
  const logger = registry.get(key);
  if (logger) {
    logger.finalize(result, additionalInfo);
    registry.delete(key);
  }
}

/**
 * Check if a shared logger exists for the given key.
 */
export function hasSharedLogger(key: string): boolean {
  return registry.has(key);
}

/**
 * Remove a shared logger without finalizing (cleanup).
 */
export function removeSharedLogger(key: string): void {
  registry.delete(key);
}
