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
  /** Log context: 'setup' | 'test' | 'teardown' (default: 'test') */
  context?: LogContext;
  /** Custom log directory (default: 'logs/') */
  logDirectory?: string;
  /** Mask Authorization headers (default: true) */
  maskAuthTokens?: boolean;
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
 * // With options:
 * const loggedRequest = withApiLogging(request, { testName: 'my-test', context: 'setup' });
 */
export function withApiLogging(
  request: APIRequestContext,
  testInfoOrOptions?: TestInfo | ApiLoggingOptions,
): APIRequestContext & { __logger: ApiLogger } {
  // Resolve options
  let options: ApiLoggingOptions;

  if (testInfoOrOptions && 'title' in testInfoOrOptions) {
    // TestInfo object
    options = {
      testName: (testInfoOrOptions as TestInfo).title,
      context: 'test',
    };
  } else {
    options = (testInfoOrOptions as ApiLoggingOptions) || {};
  }

  const config: LoggerConfig = {
    testName: options.testName,
    context: options.context || 'test',
    logDirectory: options.logDirectory,
    maskAuthTokens: options.maskAuthTokens,
  };

  const logger = new ApiLogger(config);

  // If logging is disabled, return original request with dummy logger
  if (!logger.isEnabled()) {
    return Object.assign(request, { __logger: logger });
  }

  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'];

  const proxy = new Proxy(request, {
    get(target: APIRequestContext, prop: string | symbol, receiver: any) {
      const propName = typeof prop === 'string' ? prop : '';

      // Expose logger reference
      if (propName === '__logger') {
        return logger;
      }

      if (HTTP_METHODS.includes(propName)) {
        return async (url: string, options?: any) => {
          const method = propName === 'fetch' ? (options?.method || 'GET') : propName;
          const startTime = Date.now();

          // Extract request details from Playwright options
          const requestHeaders = options?.headers;
          const requestBody = extractBody(options);
          const contentType = extractContentType(options, requestHeaders);

          try {
            const response: APIResponse = await (target as any)[propName](url, options);
            const duration = Date.now() - startTime;

            // Parse response body safely
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

/**
 * Extract body from Playwright request options
 */
function extractBody(options?: any): any {
  if (!options) return undefined;
  if (options.data) return options.data;
  if (options.form) return options.form;
  if (options.multipart) return options.multipart;
  return undefined;
}

/**
 * Detect content type from options
 */
function extractContentType(options?: any, headers?: Record<string, string>): string | undefined {
  if (options?.form) return 'application/x-www-form-urlencoded';
  if (options?.multipart) return 'multipart/form-data';
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'content-type') {
        return Array.isArray(value) ? value[0] : String(value);
      }
    }
  }
  return undefined;
}

/**
 * Safely parse response body (try JSON, fallback to text)
 */
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

/**
 * Extract headers from APIResponse
 */
function extractResponseHeaders(response: APIResponse): Record<string, string> | undefined {
  try {
    return response.headers();
  } catch {
    return undefined;
  }
}
