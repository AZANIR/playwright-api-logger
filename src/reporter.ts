/**
 * Playwright Reporter for playwright-api-logger
 *
 * Automatically merges related log files (e.g. from beforeAll + test + afterAll)
 * into a single structured document per test group.
 *
 * Usage in playwright.config.ts:
 * ```typescript
 * reporter: [
 *   ['list'],
 *   ['playwright-api-logger/reporter', { logDirectory: 'logs' }]
 * ]
 * ```
 */

import fs from 'fs';
import path from 'path';
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import { StepLogEntry, TestLogDocument } from './types';

export interface ApiLoggerReporterOptions {
  /** Log directory (default: 'logs') */
  logDirectory?: string;
  /** Merge related log files from same describe block (default: true) */
  merge?: boolean;
  /** Print summary after test run (default: true) */
  printSummary?: boolean;
}

interface ParsedLogFile {
  filePath: string;
  filename: string;
  data: TestLogDocument;
}

class ApiLoggerReporter implements Reporter {
  private logDirectory: string;
  private merge: boolean;
  private printSummary: boolean;
  private testResults = new Map<string, 'PASSED' | 'FAILED' | 'SKIPPED'>();

  constructor(options: ApiLoggerReporterOptions = {}) {
    this.logDirectory = options.logDirectory
      ? path.resolve(options.logDirectory)
      : path.join(process.cwd(), 'logs');
    this.merge = options.merge !== false;
    this.printSummary = options.printSummary !== false;
  }

  /**
   * Ensure log directory exists before tests start
   */
  onBegin(_config: FullConfig, _suite: Suite): void {
    try {
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }
    } catch {
      // Ignore — ApiLogger will also try to create it
    }
  }

  /**
   * Track test results for enriching log files
   */
  onTestEnd(test: TestCase, result: TestResult): void {
    const key = `${test.location.file}::${test.titlePath().join(' > ')}`;
    const status = result.status === 'passed'
      ? 'PASSED'
      : result.status === 'failed'
        ? 'FAILED'
        : 'SKIPPED';
    this.testResults.set(key, status);
  }

  /**
   * Post-process log files: merge related files, print summary
   */
  onEnd(_result: FullResult): void {
    try {
      if (this.merge) {
        this.mergeRelatedLogs();
      }
      if (this.printSummary) {
        this.logSummary();
      }
    } catch (error) {
      console.warn('[playwright-api-logger] Reporter error:', error);
    }
  }

  /**
   * Scan log directory, group related files by describe block, merge into single documents
   */
  private mergeRelatedLogs(): void {
    if (!fs.existsSync(this.logDirectory)) return;

    const logFiles = this.readLogFiles();
    if (logFiles.length === 0) return;

    // Group files by describe block (file + titlePath prefix)
    const groups = this.groupByDescribeBlock(logFiles);

    // Merge groups that have multiple files
    for (const [groupKey, group] of groups) {
      if (group.length <= 1) continue;

      try {
        this.mergeGroup(groupKey, group);
      } catch (error) {
        console.warn(
          `[playwright-api-logger] Failed to merge group "${groupKey}":`,
          error,
        );
      }
    }
  }

  /**
   * Read and parse all .log files from the log directory
   */
  private readLogFiles(): ParsedLogFile[] {
    const files: ParsedLogFile[] = [];

    for (const filename of fs.readdirSync(this.logDirectory)) {
      if (!filename.endsWith('.log')) continue;

      const filePath = path.join(this.logDirectory, filename);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as TestLogDocument;

        // Validate minimum structure
        if (data?.test && data?.summary) {
          files.push({ filePath, filename, data });
        }
      } catch {
        // Skip malformed files
      }
    }

    return files;
  }

  /**
   * Group log files by their describe block path.
   * Files from the same test file + same describe block → same group.
   *
   * Only groups files that have titlePath with at least 3 elements
   * (project + describe + test name), otherwise they're standalone tests.
   */
  private groupByDescribeBlock(
    files: ParsedLogFile[],
  ): Map<string, ParsedLogFile[]> {
    const groups = new Map<string, ParsedLogFile[]>();

    for (const file of files) {
      const titlePath = file.data.test?.titlePath;
      const testFile = file.data.test?.file;

      if (!titlePath || titlePath.length < 3 || !testFile) {
        // Standalone test or missing info — don't group
        continue;
      }

      // Group key: file + describe block path (all titlePath except last element)
      const describePath = titlePath.slice(0, -1).join(' > ');
      const groupKey = `${testFile}::${describePath}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(file);
    }

    return groups;
  }

  /**
   * Merge a group of related log files into a single structured document.
   *
   * Strategy:
   * - Sort files by startedAt timestamp
   * - First file's steps → preconditions section
   * - Middle files' steps → test steps section
   * - Last file's steps → teardown section
   * - If only 2 files: first → preconditions, second → steps
   * - Preserves existing section assignments (if user set context manually)
   */
  private mergeGroup(_groupKey: string, group: ParsedLogFile[]): void {
    // Sort by startedAt timestamp (earliest first)
    group.sort((a, b) => {
      const timeA = new Date(a.data.test.startedAt).getTime();
      const timeB = new Date(b.data.test.startedAt).getTime();
      return timeA - timeB;
    });

    // Build merged document
    const firstDoc = group[0].data;
    const lastDoc = group[group.length - 1].data;

    // Use the describe block name as merged test name
    const titlePath = firstDoc.test.titlePath;
    const describeName = titlePath
      ? titlePath.slice(1, -1).join(' > ')
      : firstDoc.test.name;

    const merged: TestLogDocument = {
      test: {
        name: describeName || firstDoc.test.name,
        file: firstDoc.test.file,
        titlePath: titlePath ? titlePath.slice(0, -1) : undefined,
        startedAt: firstDoc.test.startedAt,
        finishedAt: lastDoc.test.finishedAt || lastDoc.test.startedAt,
        result: this.resolveGroupResult(group),
      },
      preconditions: [],
      steps: [],
      teardown: [],
      summary: {
        totalRequests: 0,
        preconditions: 0,
        testSteps: 0,
        teardown: 0,
        totalDuration: 0,
      },
    };

    if (group.length === 2) {
      // 2 files: first → preconditions, second → steps
      merged.preconditions = this.collectAllSteps(group[0].data);
      merged.steps = this.collectAllSteps(group[1].data);
    } else {
      // 3+ files: first → preconditions, middle → steps, last → teardown
      merged.preconditions = this.collectAllSteps(group[0].data);

      for (let i = 1; i < group.length - 1; i++) {
        merged.steps.push(...this.collectAllSteps(group[i].data));
      }

      merged.teardown = this.collectAllSteps(group[group.length - 1].data);
    }

    // Re-number steps in each section
    this.renumberSteps(merged.preconditions);
    this.renumberSteps(merged.steps);
    this.renumberSteps(merged.teardown);

    // Calculate summary
    const allSteps = [
      ...merged.preconditions,
      ...merged.steps,
      ...merged.teardown,
    ];
    merged.summary = {
      totalRequests: allSteps.length,
      preconditions: merged.preconditions.length,
      testSteps: merged.steps.length,
      teardown: merged.teardown.length,
      totalDuration: allSteps.reduce((sum, s) => sum + s.duration, 0),
    };

    // Calculate total test duration
    if (merged.test.startedAt && merged.test.finishedAt) {
      merged.test.duration =
        new Date(merged.test.finishedAt).getTime() -
        new Date(merged.test.startedAt).getTime();
    }

    // Write merged file (use first file's path)
    fs.writeFileSync(
      group[0].filePath,
      JSON.stringify(merged, null, 2) + '\n',
    );

    // Remove other files in the group
    for (let i = 1; i < group.length; i++) {
      try {
        fs.unlinkSync(group[i].filePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Collect all steps from a log document (from all sections)
   */
  private collectAllSteps(doc: TestLogDocument): StepLogEntry[] {
    return [
      ...(doc.preconditions || []),
      ...(doc.steps || []),
      ...(doc.teardown || []),
    ];
  }

  /**
   * Re-number step entries sequentially
   */
  private renumberSteps(steps: StepLogEntry[]): void {
    steps.forEach((step, index) => {
      step.step = index + 1;
    });
  }

  /**
   * Determine the overall result for a group of log files.
   * FAILED wins over PASSED, PASSED wins over SKIPPED.
   */
  private resolveGroupResult(
    group: ParsedLogFile[],
  ): 'PASSED' | 'FAILED' | 'SKIPPED' {
    const results = group.map((g) => g.data.test.result).filter(Boolean);

    if (results.includes('FAILED')) return 'FAILED';
    if (results.includes('PASSED')) return 'PASSED';
    return 'SKIPPED';
  }

  /**
   * Print a summary of log files after the test run
   */
  private logSummary(): void {
    if (!fs.existsSync(this.logDirectory)) return;

    const logFiles = fs
      .readdirSync(this.logDirectory)
      .filter((f) => f.endsWith('.log'));

    if (logFiles.length === 0) return;

    let totalRequests = 0;
    let totalDuration = 0;

    for (const filename of logFiles) {
      try {
        const content = fs.readFileSync(
          path.join(this.logDirectory, filename),
          'utf-8',
        );
        const data = JSON.parse(content) as TestLogDocument;
        totalRequests += data.summary?.totalRequests || 0;
        totalDuration += data.summary?.totalDuration || 0;
      } catch {
        // Skip malformed files
      }
    }

    const durationStr =
      totalDuration > 1000
        ? `${(totalDuration / 1000).toFixed(1)}s`
        : `${totalDuration}ms`;

    console.log('');
    console.log(
      `  \x1b[36m[playwright-api-logger]\x1b[0m ${logFiles.length} log file${logFiles.length === 1 ? '' : 's'}, ${totalRequests} API request${totalRequests === 1 ? '' : 's'} (${durationStr})`,
    );
    console.log(
      `  \x1b[36m[playwright-api-logger]\x1b[0m Logs: ${this.logDirectory}`,
    );
  }
}

export default ApiLoggerReporter;
