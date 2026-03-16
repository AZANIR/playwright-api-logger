export type LogContext = 'setup' | 'test' | 'teardown';

export interface LoggerConfig {
  testName?: string;
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

export interface LogEntry {
  timestamp: string;
  testName: string;
  context: LogContext;
  request: RequestLogData;
  response: ResponseLogData;
  duration: number;
  curl: string;
}
