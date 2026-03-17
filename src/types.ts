export type LogContext = 'preconditions' | 'test' | 'teardown';

export interface LoggerConfig {
  testName?: string;
  testFile?: string;
  titlePath?: string[];
  context?: LogContext;
  logDirectory?: string;
  maskAuthTokens?: boolean;
}

export interface RequestLogData {
  method: string;
  url: string;
  headers?: Record<string, string | string[]>;
  body?: any;
  contentType?: string;
}

export interface ResponseLogData {
  status: number;
  headers?: Record<string, string>;
  body?: any;
}

export interface StepLogEntry {
  step: number;
  description?: string;
  timestamp: string;
  request: RequestLogData;
  response: ResponseLogData;
  duration: number;
  curl: string;
}

export interface TestLogDocument {
  test: {
    name: string;
    file?: string;
    titlePath?: string[];
    startedAt: string;
    finishedAt?: string;
    duration?: number;
    result?: 'PASSED' | 'FAILED' | 'SKIPPED';
  };
  preconditions: StepLogEntry[];
  steps: StepLogEntry[];
  teardown: StepLogEntry[];
  summary: {
    totalRequests: number;
    preconditions: number;
    testSteps: number;
    teardown: number;
    totalDuration: number;
  };
}

/** @deprecated Use StepLogEntry instead */
export interface LogEntry {
  timestamp: string;
  testName: string;
  context: LogContext;
  request: RequestLogData;
  response: ResponseLogData;
  duration: number;
  curl: string;
}
