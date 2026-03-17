# Response to Copilot PR Review

## Round 1 — All 5 comments addressed:

---

## 1. `testResults` / `onTestEnd` (src/reporter.ts)

**Comment:** `testResults` is populated in `onTestEnd` but never read. Either remove or wire it into merge/summary.

**Fixed:** Removed `testResults` map and `onTestEnd` method. Result for merged logs is determined from log file data via `resolveGroupResult()`.

---

## 2. Merge strategy documentation (src/reporter.ts)

**Comment:** JSDoc says "preserves existing section assignments" but `collectAllSteps()` flattens and reassigns by file order.

**Fixed:** Updated JSDoc to match actual behavior: "Per-document section assignments are flattened and reassigned by file order; manual context in a single file is not preserved when merging."

---

## 3. createSetupLogger test (tests/ApiLogger.spec.ts)

**Comment:** `logDir` created but never passed to `createSetupLogger()` — cleanup is no-op.

**Fixed:** Removed `logDir` and cleanup. Test now only verifies `createSetupLogger` returns an enabled logger with preconditions context.

---

## 4. testInfo test (tests/withApiLogging.spec.ts)

**Comment:** `logDir` created/deleted but never passed to `withApiLogging`.

**Fixed:** Now passes `logDirectory: logDir` in options, performs `get` + `finalize`, and asserts log file content (test name, file, titlePath, steps).

---

## 5. README auto-merge (README.md)

**Comment:** README claims auto-merge for beforeAll+test+afterAll, but hooks don't receive `testInfo` — clarify.

**Fixed:** 
- Features: "when `titlePath`/`file` are set"
- Reporter section: added note about merge requirements and manual `testFile`/`titlePath` in hooks
- New section "Merge with beforeAll/afterAll hooks" with example using `sharedKey`, `testFile`, `titlePath`, `context`

---

## Round 2 (v2) — 8 comments addressed:

- demo-log.spec: skip unless `API_LOGS=true` (test.skip)
- withApiLogging: temp logDirectory in proxied request + pass through non-HTTP tests
- ApiLogger: temp logDirectory in "should be enabled" + factory tests
- LoggerRegistry: temp logDirectory in getSharedLogger tests
- reporter.spec: mkdtempSync instead of Date.now() for onBegin test
- ApiLogger.finalize: fallback to `additionalInfo?.titlePath`
- ApiLogger factories: optional `config` with `logDirectory`

---

## Round 3 (v3) — 3 comments addressed:

### 6. createSetupLogger context override (src/ApiLogger.ts)

**Comment:** `{ context: 'preconditions', ...config }` allows caller to override context via `{ context: 'test' }`.

**Fixed:** Spread `config` before `context`: `{ testName, ...config, context: 'preconditions' }` — factory semantics guaranteed.

---

### 7. createTeardownLogger context override (src/ApiLogger.ts)

**Comment:** Same as above — config can override teardown context.

**Fixed:** `{ testName, ...config, context: 'teardown' }`.

---

### 8. readLogFiles startedAt validation (src/reporter.ts)

**Comment:** Merge logic uses `startedAt` for sorting; malformed/partial logs with invalid `startedAt` → NaN sort keys → incorrect merge.

**Fixed:** Validate `test.startedAt` as parseable date before adding to merge candidates. Skip files with missing/invalid `startedAt`. Added test case in "should skip malformed log files gracefully" for invalid `startedAt`.
