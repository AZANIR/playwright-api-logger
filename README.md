<p align="center">
  <img src="https://playwright.dev/img/playwright-logo.svg" width="80" alt="Playwright Logo" />
</p>

<h1 align="center">playwright-api-logger</h1>

<p align="center">
  Comprehensive API request/response logger with curl export for Playwright tests
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/playwright-api-logger"><img src="https://img.shields.io/npm/v/playwright-api-logger.svg?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/playwright-api-logger"><img src="https://img.shields.io/npm/dm/playwright-api-logger.svg?style=flat-square&color=blue" alt="npm downloads" /></a>
  <a href="https://github.com/AZANIR/playwright-api-logger/blob/master/LICENSE"><img src="https://img.shields.io/github/license/AZANIR/playwright-api-logger?style=flat-square" alt="license" /></a>
  <a href="https://playwright.dev/"><img src="https://img.shields.io/badge/Playwright-%3E%3D1.40-45ba4b?style=flat-square&logo=playwright" alt="Playwright" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0+-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

---

## How It Works

```mermaid
flowchart LR
    subgraph T[Playwright Test]
        F[Fixture setup]
        C[API Call GET/POST/PUT/DELETE]
    end

    subgraph P[playwright-api-logger]
        W["withApiLogging(request, testInfo)"]
        PR[Proxy over APIRequestContext]
        AL[ApiLogger]
        CG[CurlGenerator]
        RP["ApiLoggerReporter<br/>(merge + summary)"]
    end

    subgraph O[Output]
        LOG["logs/*.log<br/>structured JSON per test"]
        RC[Ready-to-use curl for Postman / terminal]
    end

    F -->|"1 line change"| W
    W --> PR
    C --> PR
    PR --> AL
    AL --> CG
    AL -->|"raw files"| RP
    RP -->|"merged"| LOG
    CG --> RC
```

```
API_LOGS=true  → Logging ON   (files created in logs/)
API_LOGS=false → Logging OFF  (zero overhead, default)
```

## Features

- **One-line integration** — just wrap `request` with `withApiLogging()`, zero changes to controllers/clients
- **Playwright Reporter** — auto-merges related log files (beforeAll + test + afterAll → one file), prints summary
- **Structured logs** — one JSON document per test with `preconditions`, `steps`, and `teardown` sections
- **Step descriptions** — describe what each API call does with `.describe()`
- **Curl Export** — copy from log, paste into terminal or import into Postman
- **Env Control** — `API_LOGS=true/false` (default: `false`, zero overhead when off)
- **Token Masking** — Authorization headers are automatically masked
- **Form Data** — JSON, URL-encoded, and multipart/form-data support
- **Error Resilient** — logging never breaks your tests

## Installation

```bash
npm install playwright-api-logger
```

## Quick Start

### One line in your fixture — that's it!

```typescript
import { withApiLogging } from 'playwright-api-logger';

export const test = base.extend({
  loggedRequest: async ({ request }, use, testInfo) => {
    const logged = withApiLogging(request, testInfo);
    await use(logged);
    logged.__logger.finalize(
      testInfo.status === 'passed' ? 'PASSED' : 'FAILED'
    );
  },
  apiClient: async ({ loggedRequest }, use) => {
    await use(new ApiClient(loggedRequest));
  },
});
```

No changes to your controllers, clients, or test files.

### Add the Reporter (recommended)

Add the reporter to `playwright.config.ts` for automatic log merging and summary:

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['playwright-api-logger/reporter']
  ],
  // ...
});
```

The reporter will:
- **Auto-merge** related log files from `beforeAll` + `test` + `afterAll` into one structured document
- **Print summary** after the test run (number of log files, total API requests, duration)

```
  [playwright-api-logger] 5 log files, 23 API requests (4.2s)
  [playwright-api-logger] Logs: /path/to/project/logs
```

Reporter options:

```typescript
['playwright-api-logger/reporter', {
  logDirectory: 'custom-logs',  // default: 'logs'
  merge: true,                  // auto-merge related files (default: true)
  printSummary: true,           // print summary at end (default: true)
}]
```

### With preconditions and step descriptions

Expose `loggedRequest` as a fixture to access the logger in tests:

```typescript
// fixtures.ts
export const test = base.extend({
  loggedRequest: async ({ request }, use, testInfo) => {
    const logged = withApiLogging(request, testInfo);
    await use(logged);
    logged.__logger.finalize(
      testInfo.status === 'passed' ? 'PASSED' : 'FAILED'
    );
  },
  apiClient: async ({ loggedRequest }, use) => {
    await use(new ApiClient(loggedRequest));
  },
});
```

```typescript
// test file
test('GET Without token (401)', async ({ apiClient, loggedRequest }) => {
  const logger = loggedRequest.__logger;

  // Mark following calls as preconditions
  logger.startPreconditions();
  logger.describe('Get employee ID for test');
  const employees = await apiClient.getEmployees({ page: 1, size: 1 });
  const employeeId = employees.items[0].id;

  // Switch to test steps
  logger.startTest();
  logger.describe('Get children without auth token');
  const response = await apiClient.getChildrenWithoutAuth(employeeId);
  expect(response.status).toBe(401);
});
```

### Enable via environment variable

```bash
# .env
API_LOGS=false
```

```bash
# Run with logging enabled
API_LOGS=true npx playwright test
```

## Log Output

One structured JSON document per test:

```
logs/
  get-without-token-401_2026-03-16T18-33-03.log
  create-employee_2026-03-16T18-35-10.log
```

### Example log:

```json
{
  "test": {
    "name": "GET Without token (401)",
    "file": "tests/api/employees/children.spec.ts",
    "titlePath": ["", "GET /api/v1/employees/{id}/children", "GET Without token (401)"],
    "startedAt": "2026-03-16T18:33:03.654Z",
    "finishedAt": "2026-03-16T18:33:04.300Z",
    "duration": 646,
    "result": "PASSED"
  },
  "preconditions": [
    {
      "step": 1,
      "description": "Get employee ID for test",
      "timestamp": "2026-03-16T18:33:04.174Z",
      "request": {
        "method": "GET",
        "url": "https://api.example.com/employees?page=1&size=1"
      },
      "response": {
        "status": 200,
        "body": { "items": [{ "id": "abc-123" }], "total": 27 }
      },
      "duration": 501,
      "curl": "curl -X GET 'https://api.example.com/employees?page=1&size=1' -H 'Accept: application/json'"
    }
  ],
  "steps": [
    {
      "step": 1,
      "description": "Get children without auth token",
      "timestamp": "2026-03-16T18:33:04.242Z",
      "request": {
        "method": "GET",
        "url": "https://api.example.com/employees/abc-123/children"
      },
      "response": {
        "status": 401,
        "body": { "detail": "Not authenticated" }
      },
      "duration": 67,
      "curl": "curl -X GET 'https://api.example.com/employees/abc-123/children'"
    }
  ],
  "teardown": [],
  "summary": {
    "totalRequests": 2,
    "preconditions": 1,
    "testSteps": 1,
    "teardown": 0,
    "totalDuration": 568
  }
}
```

## API Reference

### `withApiLogging(request, testInfoOrOptions?)` ⭐

Main integration point. Wraps `APIRequestContext` with a Proxy that logs all HTTP calls.

```typescript
const loggedRequest = withApiLogging(request, testInfo);
loggedRequest.__logger // access the ApiLogger instance
```

### `ApiLogger` — context & description

| Method | Description |
|--------|-------------|
| `describe(text)` | Set description for the **next** API call |
| `startPreconditions()` | Following calls → `preconditions` section |
| `startTest()` | Following calls → `steps` section |
| `startTeardown()` | Following calls → `teardown` section |
| `setContext(ctx)` | Set context directly (`'preconditions'` / `'test'` / `'teardown'`) |
| `finalize(result, info?)` | Write structured JSON document to file |
| `isEnabled()` | Check if logging is active |
| `getLogFilePath()` | Get current log file path |

### `ApiLoggerReporter` — Playwright Reporter

Auto-merges related log files and prints summary. Add to `playwright.config.ts`:

```typescript
reporter: [['list'], ['playwright-api-logger/reporter']]
```

| Option | Default | Description |
|--------|---------|-------------|
| `logDirectory` | `'logs'` | Directory for log files |
| `merge` | `true` | Auto-merge related log files by describe block |
| `printSummary` | `true` | Print API request summary after test run |

### `CurlGenerator`

| Method | Description |
|--------|-------------|
| `CurlGenerator.generate(requestData, maskAuth?)` | Generate curl command string |

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `API_LOGS` | `false` | Set to `'true'` to enable logging |

### `ApiLoggingOptions`

```typescript
{
  testName?: string;        // Test name (default: 'unknown-test')
  testFile?: string;        // Test file path
  titlePath?: string[];     // Test hierarchy path (auto-detected from testInfo)
  context?: LogContext;      // 'preconditions' | 'test' | 'teardown'
  logDirectory?: string;     // Custom log dir (default: 'logs/')
  maskAuthTokens?: boolean;  // Mask auth headers (default: true)
  logger?: ApiLogger;        // Reuse existing logger instance
}
```

## Migration from v1 → v2

```diff
- // v1: manual logger setup in controllers and clients
- const logger = createApiLogger(testInfo.title);
- apiClient.setApiLogger(logger);

+ // v2: one line, structured logs with sections
+ const loggedRequest = withApiLogging(request, testInfo);
+ const apiClient = new ApiClient(loggedRequest);
```

## License

MIT
