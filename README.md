# playwright-api-logger

Comprehensive API request/response logger with curl export for Playwright tests.

## Features

- Full request/response logging (method, URL, headers, body, status, timing)
- Curl command generation — copy and paste into terminal or import into Postman
- Environment-based control via `API_LOGS` env variable (default: `false`)
- Test context tracking (setup / test / teardown)
- Authorization token masking
- Support for JSON, URL-encoded form data, and multipart/form-data
- Error-resilient — logging never breaks your tests

## Installation

```bash
npm install playwright-api-logger
```

## Quick Start

### 1. Add logger to your fixture

```typescript
import { createApiLogger } from 'playwright-api-logger';

export const test = base.extend({
  apiClient: async ({ request }, use, testInfo) => {
    const apiClient = new ApiClient(request);

    if (process.env.API_LOGS === 'true') {
      const logger = createApiLogger(testInfo.title, 'test');
      apiClient.setApiLogger(logger);
      await use(apiClient);
      logger.finalize(testInfo.status === 'passed' ? 'PASSED' : 'FAILED');
    } else {
      await use(apiClient);
    }
  },
});
```

### 2. Add logging to your base API controller

```typescript
import { ApiLogger } from 'playwright-api-logger';

class BaseApiController {
  protected apiLogger: ApiLogger | null = null;

  setApiLogger(logger: ApiLogger): void {
    this.apiLogger = logger;
  }

  async get(url: string, headers?: Record<string, string>) {
    const startTime = Date.now();
    const response = await this.request.get(url, { headers });
    const duration = Date.now() - startTime;

    if (this.apiLogger?.isEnabled()) {
      const body = await response.json().catch(() => response.text());
      this.apiLogger.logApiCall('GET', url, headers, undefined, response.status(), undefined, body, duration);
    }

    return response;
  }
}
```

### 3. Enable via environment variable

```bash
# .env
API_LOGS=false
```

```bash
# Run with logging enabled
API_LOGS=true npx playwright test
```

## Log Output

Logs are saved to `logs/` directory as JSON files:

```
logs/
  TEST_my-test-name_2026-03-16T12-00-00.log
  SETUP_auth-setup_2026-03-16T12-00-00.log
```

Each log entry contains:

```json
{
  "timestamp": "2026-03-16T12:00:00.000Z",
  "testName": "my-test-name",
  "context": "test",
  "request": {
    "method": "POST",
    "url": "https://api.example.com/users",
    "headers": { "Content-Type": "application/json" },
    "body": { "name": "John" }
  },
  "response": {
    "status": 201,
    "body": { "id": 1, "name": "John" }
  },
  "duration": 150,
  "curl": "curl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' --data '{\"name\":\"John\"}'"
}
```

## API

### `createApiLogger(testName, context?)`
Factory function. Returns `ApiLogger` instance.
- `testName` — test name for log filename
- `context` — `'setup'` | `'test'` | `'teardown'` (default: `'test'`)

### `createSetupLogger(testName)`
Shortcut for `createApiLogger(testName, 'setup')`.

### `createTeardownLogger(testName)`
Shortcut for `createApiLogger(testName, 'teardown')`.

### `ApiLogger`

| Method | Description |
|--------|-------------|
| `logApiCall(method, url, reqHeaders, reqBody, status, resHeaders, resBody, duration)` | Log complete request/response |
| `logRequest(method, url, headers?, body?)` | Log request (pair with `logResponse`) |
| `logResponse(status, headers?, body?)` | Log response (pair with `logRequest`) |
| `isEnabled()` | Check if logging is active |
| `finalize(result, additionalInfo?)` | Write test result to log |
| `getLogFilePath()` | Get current log file path |

### `CurlGenerator`

| Method | Description |
|--------|-------------|
| `CurlGenerator.generate(requestData, maskAuth?)` | Generate curl command string |

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `API_LOGS` | `false` | Set to `'true'` to enable logging |

### `LoggerConfig`

```typescript
{
  testName?: string;        // Test name (default: 'unknown-test')
  context?: LogContext;      // 'setup' | 'test' | 'teardown'
  logDirectory?: string;     // Custom log dir (default: 'logs/')
  maskAuthTokens?: boolean;  // Mask auth headers (default: true)
}
```

## License

MIT
