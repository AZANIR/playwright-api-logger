/**
 * API Logger for capturing and logging HTTP requests/responses
 * Features:
 * - Comprehensive request/response logging
 * - Curl command generation for manual testing
 * - Environment-based enable/disable via API_LOGS
 * - Automatic file logging with JSON format
 * - Test context tracking (setup/test/teardown)
 */

import fs from 'fs';
import path from 'path';
import { CurlGenerator } from './CurlGenerator';
import {
  LogContext,
  LoggerConfig,
  RequestLogData,
  ResponseLogData,
  LogEntry,
} from './types';

export class ApiLogger {
  private enabled: boolean;
  private testName: string;
  private context: LogContext;
  private logDirectory: string;
  private logFilePath: string | null = null;
  private maskAuthTokens: boolean;
  private currentRequest: RequestLogData | null = null;
  private requestStartTime: number | null = null;

  constructor(config: LoggerConfig = {}) {
    // Check if logging is enabled via environment variable
    this.enabled = process.env.API_LOGS === 'true';

    this.testName = config.testName || 'unknown-test';
    this.context = config.context || 'test';
    this.logDirectory = config.logDirectory || this.getDefaultLogDirectory();
    this.maskAuthTokens = config.maskAuthTokens ?? true;

    if (this.enabled) {
      this.initializeLogFile();
    }
  }

  /**
   * Get default log directory path
   */
  private getDefaultLogDirectory(): string {
    return path.join(process.cwd(), 'logs');
  }

  /**
   * Initialize log file and directory
   */
  private initializeLogFile(): void {
    try {
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }

      const timestamp = this.generateTimestamp();
      const sanitizedTestName = this.sanitizeTestName(this.testName);
      const filename = `${this.context.toUpperCase()}_${sanitizedTestName}_${timestamp}.log`;
      this.logFilePath = path.join(this.logDirectory, filename);

      if (!fs.existsSync(this.logFilePath)) {
        fs.writeFileSync(this.logFilePath, '');
      }
    } catch (error) {
      console.warn('[ApiLogger] Failed to initialize log file:', error);
      this.logFilePath = null;
    }
  }

  /**
   * Log an API call with request and response
   */
  logApiCall(
    method: string,
    url: string,
    requestHeaders: Record<string, string | string[]> | undefined,
    requestBody: any,
    status: number,
    responseHeaders: Record<string, string> | undefined,
    responseBody: any,
    duration: number,
  ): void {
    if (!this.enabled) {
      return;
    }

    try {
      // Extract content type from headers
      let contentType: string | undefined;
      if (requestHeaders) {
        for (const [key, value] of Object.entries(requestHeaders)) {
          if (key.toLowerCase() === 'content-type') {
            contentType = Array.isArray(value) ? value[0] : value;
            break;
          }
        }
      }

      const requestData: RequestLogData = {
        method,
        url,
        headers: requestHeaders,
        body: requestBody,
        contentType,
      };

      const responseData: ResponseLogData = {
        status,
        headers: responseHeaders,
        body: responseBody,
      };

      // Generate curl command
      const curl = CurlGenerator.generate(requestData, this.maskAuthTokens);

      // Create log entry
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        testName: this.testName,
        context: this.context,
        request: requestData,
        response: responseData,
        duration,
        curl,
      };

      this.writeLogEntry(logEntry);
    } catch (error) {
      console.warn('[ApiLogger] Error logging API call:', error);
    }
  }

  /**
   * Log just the request part (when response isn't available yet)
   */
  logRequest(method: string, url: string, headers?: Record<string, string | string[]>, body?: any): void {
    if (!this.enabled) {
      return;
    }

    this.currentRequest = { method, url, headers, body };
    this.requestStartTime = Date.now();
  }

  /**
   * Log just the response part (pairs with logRequest)
   */
  logResponse(status: number, headers?: Record<string, string>, body?: any): void {
    if (!this.enabled || !this.currentRequest) {
      return;
    }

    const duration = this.requestStartTime ? Date.now() - this.requestStartTime : 0;

    this.logApiCall(
      this.currentRequest.method,
      this.currentRequest.url,
      this.currentRequest.headers,
      this.currentRequest.body,
      status,
      headers,
      body,
      duration,
    );

    this.currentRequest = null;
    this.requestStartTime = null;
  }

  /**
   * Write log entry to file
   */
  private writeLogEntry(entry: LogEntry): void {
    try {
      if (!this.logFilePath) {
        return;
      }

      const logLine = JSON.stringify(entry, null, 2);
      fs.appendFileSync(this.logFilePath, logLine + '\n\n');
    } catch (error) {
      console.warn('[ApiLogger] Failed to write log file:', error);
    }
  }

  /**
   * Generate ISO timestamp for filenames
   */
  private generateTimestamp(): string {
    const now = new Date();
    return now
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', 'T')
      .split('.')[0];
  }

  /**
   * Sanitize test name for use in filename
   */
  private sanitizeTestName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 80);
  }

  /**
   * Get the current log file path
   */
  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  /**
   * Check if logger is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Finalize logging for test completion
   */
  finalize(result: 'PASSED' | 'FAILED' | 'SKIPPED', additionalInfo?: Record<string, any>): void {
    if (!this.enabled) {
      return;
    }

    try {
      const finalizationEntry = {
        timestamp: new Date().toISOString(),
        step: 'TEST_FINALIZATION',
        testName: this.testName,
        context: this.context,
        result,
        logFilePath: this.logFilePath,
        additionalInfo,
      };

      if (this.logFilePath) {
        fs.appendFileSync(this.logFilePath, JSON.stringify(finalizationEntry, null, 2) + '\n\n');
      }
    } catch (error) {
      console.warn('[ApiLogger] Error finalizing log:', error);
    }
  }
}

/**
 * Factory function for creating test-context loggers
 */
export function createApiLogger(testName: string, context: LogContext = 'test'): ApiLogger {
  return new ApiLogger({ testName, context });
}

/**
 * Factory for setup context
 */
export function createSetupLogger(testName: string): ApiLogger {
  return new ApiLogger({ testName, context: 'setup' });
}

/**
 * Factory for teardown context
 */
export function createTeardownLogger(testName: string): ApiLogger {
  return new ApiLogger({ testName, context: 'teardown' });
}
