/**
 * Proxy-based API logging wrapper for Playwright's APIRequestContext
 * Zero changes to your controllers/clients — just wrap `request` in the fixture
 */

import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test';
import { ApiLogger } from './ApiLogger';
import { LogContext, LoggerConfig } from './types';

export interface ApiLoggingOptions {
  /** Test name for log filename (auto-detected from testInfo if provided) */
  testName?: string;
  /** Test file path (auto-detected from testInfo if provided) */
  testFile?: string;
  /** Log context: 'preconditions' | 'test' | 'teardown' (default: 'test') */
  context?: LogContext;
  /** Custom log directory (default: 'logs/') */
  logDirectory?: string;
  /** Mask Authorization headers (default: true) */
  maskAuthTokens?: boolean;
  /** Existing logger to share across setup/test/teardown phases */
  logger?: ApiLogger;
}

/**
 * Wrap Playwright's APIRequestContext with automatic logging.
 * All HTTP calls (get, post, put, patch, delete, head, fetch) are intercepted and logged.
 *
 * @param request - Playwright APIRequestContext
 * @param testInfoOrOptions - TestInfo object or ApiLoggingOptions
 * @returns Proxied APIRequestContext with logging + logger reference via `__logger`
 *
 * @example
 * // Minimal — just pass testInfo:
 * const loggedRequest = withApiLogging(request, testInfo);
 * const apiClient = new ApiClient(loggedRequest);
 *
 * @example
 * // With preconditions and test steps:
 * const loggedRequest = withApiLogging(request, testInfo);
 * loggedRequest.__logger.startPreconditions();
 * loggedRequest.__logger.describe('Get employee for test');
 * await apiClient.getEmployees();
 * loggedRequest.__logger.startTest();
 * loggedRequest.__logger.describe('Try to access without token');
 * await apiClient.getWithoutAuth();
 * loggedRequest.__logger.finalize('PASSED');
 */
export function withApiLogging(
  request: APIRequestContext,
  testInfoOrOptions?: TestInfo | ApiLoggingOptions,
): APIRequestContext & { __logger: ApiLogger } {
  let options: ApiLoggingOptions;

  if (testInfoOrOptions && 'title' in testInfoOrOptions) {
    const testInfo = testInfoOrOptions as TestInfo;
    options = {
      testName: testInfo.title,
      testFile: testInfo.file,
      context: 'test',
    };
  } else {
    options = (testInfoOrOptions as ApiLoggingOptions) || {};
  }

  // Use shared logger or create new
  let logger: ApiLogger;

  if (options.logger) {
    logger = options.logger;
    if (options.context) {
      logger.setContext(options.context);
    }
  } else {
    const config: LoggerConfig = {
      testName: options.testName,
      testFile: options.testFile,
      context: options.context || 'test',
      logDirectory: options.logDirectory,
      maskAuthTokens: options.maskAuthTokens,
    };
    logger = new ApiLogger(config);
  }

  // If logging is disabled, return original request with logger ref
  if (!logger.isEnabled()) {
    return Object.assign(request, { __logger: logger });
  }

  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'];

  const proxy = new Proxy(request, {
    get(target: APIRequestContext, prop: string | symbol, receiver: any) {
      const propName = typeof prop === 'string' ? prop : '';

      if (propName === '__logger') {
        return logger;
      }

      if (HTTP_METHODS.includes(propName)) {
        return async (url: string, reqOptions?: any) => {
          const method = propName === 'fetch' ? (reqOptions?.method || 'GET') : propName;
          const startTime = Date.now();

          const requestHeaders = reqOptions?.headers;
          const requestBody = extractBody(reqOptions);

          try {
            const response: APIResponse = await (target as any)[propName](url, reqOptions);
            const duration = Date.now() - startTime;

            const responseBody = await safeParseResponseBody(response);
            const responseHeaders = extractResponseHeaders(response);

            logger.logApiCall(
              method.toUpperCase(),
              response.url(),
              requestHeaders,
              requestBody,
              response.status(),
              responseHeaders,
              responseBody,
              duration,
            );

            return response;
          } catch (error) {
            const duration = Date.now() - startTime;

            logger.logApiCall(
              method.toUpperCase(),
              url,
              requestHeaders,
              requestBody,
              0,
              undefined,
              { error: String(error) },
              duration,
            );

            throw error;
          }
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });

  return Object.assign(proxy, { __logger: logger }) as APIRequestContext & { __logger: ApiLogger };
}

function extractBody(options?: any): any {
  if (!options) return undefined;
  if (options.data) return options.data;
  if (options.form) return options.form;
  if (options.multipart) return options.multipart;
  return undefined;
}

async function safeParseResponseBody(response: APIResponse): Promise<any> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

function extractResponseHeaders(response: APIResponse): Record<string, string> | undefined {
  try {
    return response.headers();
  } catch {
    return undefined;
  }
}
