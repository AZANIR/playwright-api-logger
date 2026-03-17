/**
 * API Logger for capturing and logging HTTP requests/responses
 * Produces a single structured test document with preconditions, steps, and teardown sections.
 *
 * Features:
 * - Structured test document (one JSON per test)
 * - Preconditions / Steps / Teardown sections
 * - Step descriptions and numbering
 * - Curl command generation for manual testing
 * - Environment-based enable/disable via API_LOGS
 * - Test context tracking and switching
 */

import fs from 'fs';
import path from 'path';
import { CurlGenerator } from './CurlGenerator';
import {
  LogContext,
  LoggerConfig,
  RequestLogData,
  ResponseLogData,
  StepLogEntry,
  TestLogDocument,
} from './types';

export class ApiLogger {
  private enabled: boolean;
  private testName: string;
  private testFile?: string;
  private titlePath?: string[];
  private currentContext: LogContext;
  private logDirectory: string;
  private logFilePath: string | null = null;
  private maskAuthTokens: boolean;
  private startedAt: string;

  // Structured storage
  private preconditions: StepLogEntry[] = [];
  private steps: StepLogEntry[] = [];
  private teardownSteps: StepLogEntry[] = [];

  // Next step description
  private nextDescription?: string;

  constructor(config: LoggerConfig = {}) {
    this.enabled = process.env.API_LOGS === 'true';

    this.testName = config.testName || 'unknown-test';
    this.testFile = config.testFile;
    this.titlePath = config.titlePath;
    this.currentContext = config.context || 'test';
    this.logDirectory = config.logDirectory || this.getDefaultLogDirectory();
    this.maskAuthTokens = config.maskAuthTokens ?? true;
    this.startedAt = new Date().toISOString();

    if (this.enabled) {
      this.initializeLogFile();
    }
  }

  private getDefaultLogDirectory(): string {
    return path.join(process.cwd(), 'logs');
  }

  private initializeLogFile(): void {
    try {
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }

      const timestamp = this.generateTimestamp();
      const sanitizedTestName = this.sanitizeTestName(this.testName);
      const filename = `${sanitizedTestName}_${timestamp}.log`;
      this.logFilePath = path.join(this.logDirectory, filename);
    } catch (error) {
      console.warn('[ApiLogger] Failed to initialize log file:', error);
      this.logFilePath = null;
    }
  }

  /**
   * Set description for the next API call
   * @example
   * logger.describe('Get employee ID for testing');
   * await apiClient.getEmployees(); // this call gets the description
   */
  describe(description: string): void {
    this.nextDescription = description;
  }

  /**
   * Switch current context (preconditions → test → teardown)
   * All subsequent API calls will be logged to the new context section
   */
  setContext(context: LogContext): void {
    this.currentContext = context;
  }

  /**
   * Shortcut: switch to preconditions context
   */
  startPreconditions(): void {
    this.currentContext = 'preconditions';
  }

  /**
   * Shortcut: switch to test steps context
   */
  startTest(): void {
    this.currentContext = 'test';
  }

  /**
   * Shortcut: switch to teardown context
   */
  startTeardown(): void {
    this.currentContext = 'teardown';
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

      const curl = CurlGenerator.generate(requestData, this.maskAuthTokens);

      // Get target array and step number
      const targetArray = this.getTargetArray();
      const stepNumber = targetArray.length + 1;

      const stepEntry: StepLogEntry = {
        step: stepNumber,
        description: this.nextDescription,
        timestamp: new Date().toISOString(),
        request: requestData,
        response: responseData,
        duration,
        curl,
      };

      // Clear description after use
      this.nextDescription = undefined;

      targetArray.push(stepEntry);
    } catch (error) {
      console.warn('[ApiLogger] Error logging API call:', error);
    }
  }

  /**
   * Get the target array for current context
   */
  private getTargetArray(): StepLogEntry[] {
    switch (this.currentContext) {
      case 'preconditions':
        return this.preconditions;
      case 'teardown':
        return this.teardownSteps;
      case 'test':
      default:
        return this.steps;
    }
  }

  /**
   * Finalize and write the structured test document to file
   */
  finalize(result: 'PASSED' | 'FAILED' | 'SKIPPED', additionalInfo?: Record<string, any>): void {
    if (!this.enabled) {
      return;
    }

    try {
      const finishedAt = new Date().toISOString();
      const startTime = new Date(this.startedAt).getTime();
      const endTime = new Date(finishedAt).getTime();

      // Calculate total API duration
      const allSteps = [...this.preconditions, ...this.steps, ...this.teardownSteps];
      const totalApiDuration = allSteps.reduce((sum, s) => sum + s.duration, 0);

      const document: TestLogDocument = {
        test: {
          name: this.testName,
          file: this.testFile || additionalInfo?.testFile,
          titlePath: this.titlePath || additionalInfo?.titlePath,
          startedAt: this.startedAt,
          finishedAt,
          duration: endTime - startTime,
          result,
        },
        preconditions: this.preconditions,
        steps: this.steps,
        teardown: this.teardownSteps,
        summary: {
          totalRequests: allSteps.length,
          preconditions: this.preconditions.length,
          testSteps: this.steps.length,
          teardown: this.teardownSteps.length,
          totalDuration: totalApiDuration,
        },
      };

      this.writeDocument(document);
    } catch (error) {
      console.warn('[ApiLogger] Error finalizing log:', error);
    }
  }

  /**
   * Write structured document to file
   */
  private writeDocument(document: TestLogDocument): void {
    try {
      if (!this.logFilePath) {
        return;
      }
      fs.writeFileSync(this.logFilePath, JSON.stringify(document, null, 2) + '\n');
    } catch (error) {
      console.warn('[ApiLogger] Failed to write log file:', error);
    }
  }

  private generateTimestamp(): string {
    return new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .split('.')[0];
  }

  private sanitizeTestName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 80);
  }

  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Factory function for creating test-context loggers
 * @param contextOrConfig - LogContext ('preconditions'|'test'|'teardown') or Partial<LoggerConfig>
 */
export function createApiLogger(
  testName: string,
  contextOrConfig?: LogContext | Partial<LoggerConfig>,
): ApiLogger {
  const isContext = (x: unknown): x is LogContext =>
    x === 'preconditions' || x === 'test' || x === 'teardown';
  const config = !contextOrConfig
    ? { testName, context: 'test' as LogContext }
    : isContext(contextOrConfig)
      ? { testName, context: contextOrConfig }
      : { testName, context: 'test' as LogContext, ...contextOrConfig };
  return new ApiLogger(config);
}

/**
 * Factory for setup/preconditions context
 */
export function createSetupLogger(
  testName: string,
  config?: Partial<LoggerConfig>,
): ApiLogger {
  return new ApiLogger({ testName, ...config, context: 'preconditions' });
}

/**
 * Factory for teardown context
 */
export function createTeardownLogger(
  testName: string,
  config?: Partial<LoggerConfig>,
): ApiLogger {
  return new ApiLogger({ testName, ...config, context: 'teardown' });
}
