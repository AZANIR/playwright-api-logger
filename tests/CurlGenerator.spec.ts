import { test, expect } from '@playwright/test';
import { CurlGenerator, RequestData } from '../src/CurlGenerator';

test.describe('CurlGenerator', () => {
  test.describe('generate()', () => {
    test('should generate a simple GET request', () => {
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toBe("curl -X GET 'https://api.example.com/users'");
    });

    test('should generate a POST request with JSON body', () => {
      const data: RequestData = {
        method: 'POST',
        url: 'https://api.example.com/users',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'John', age: 30 },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain("curl -X POST 'https://api.example.com/users'");
      expect(curl).toContain("-H 'Content-Type: application/json'");
      expect(curl).toContain('--data');
      expect(curl).toContain('"name":"John"');
    });

    test('should sort headers alphabetically', () => {
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: { 'X-Custom': 'value1', Accept: 'application/json' },
      };
      const curl = CurlGenerator.generate(data);
      const acceptIdx = curl.indexOf('Accept');
      const customIdx = curl.indexOf('X-Custom');
      expect(acceptIdx).toBeLessThan(customIdx);
    });

    test('should mask Authorization header by default', () => {
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: {
          Authorization:
            'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.very-long-token-over-thirty-chars',
        },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(curl).toContain('...');
    });

    test('should not mask Authorization when maskAuth=false', () => {
      const token = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.long-token';
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: { Authorization: token },
      };
      const curl = CurlGenerator.generate(data, false);
      expect(curl).toContain(token);
    });

    test('should mask short tokens completely', () => {
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: { Authorization: 'Bearer short' },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain('***masked***');
    });

    test('should skip internal headers', () => {
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: {
          host: 'api.example.com',
          'user-agent': 'playwright',
          connection: 'keep-alive',
          'content-length': '42',
          Accept: 'application/json',
        },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).not.toContain("'host:");
      expect(curl).not.toContain("'user-agent:");
      expect(curl).not.toContain("'connection:");
      expect(curl).not.toContain("'content-length:");
      expect(curl).toContain('Accept');
    });

    test('should not include body for GET requests', () => {
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
        body: { query: 'test' },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).not.toContain('--data');
    });

    test('should include body for PUT requests', () => {
      const data: RequestData = {
        method: 'PUT',
        url: 'https://api.example.com/users/1',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Updated' },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain('--data');
      expect(curl).toContain('"name":"Updated"');
    });

    test('should include body for PATCH requests', () => {
      const data: RequestData = {
        method: 'PATCH',
        url: 'https://api.example.com/users/1',
        body: { email: 'new@test.com' },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain('--data');
    });

    test('should handle form-urlencoded body', () => {
      const data: RequestData = {
        method: 'POST',
        url: 'https://api.example.com/login',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: { username: 'admin', password: 'secret' },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain('--data');
      expect(curl).toContain('username=admin');
      expect(curl).toContain('password=secret');
    });

    test('should handle multipart form data with file fields', () => {
      const data: RequestData = {
        method: 'POST',
        url: 'https://api.example.com/upload',
        contentType: 'multipart/form-data',
        body: {
          title: 'My Document',
          file: { path: '/tmp/test.pdf' },
        },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain("-F 'title=My Document'");
      expect(curl).toContain("-F 'file=@/tmp/test.pdf'");
    });

    test('should handle string body as-is', () => {
      const data: RequestData = {
        method: 'POST',
        url: 'https://api.example.com/data',
        body: 'raw string body',
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain("--data 'raw string body'");
    });

    test('should escape single quotes in body', () => {
      const data: RequestData = {
        method: 'POST',
        url: 'https://api.example.com/data',
        body: { name: "O'Brien" },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain("O'\\''Brien");
    });

    test('should handle array header values', () => {
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: { Accept: ['application/json', 'text/plain'] },
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toContain('application/json, text/plain');
    });

    test('should handle empty headers', () => {
      const data: RequestData = {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: {},
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toBe("curl -X GET 'https://api.example.com/users'");
    });

    test('should handle DELETE method', () => {
      const data: RequestData = {
        method: 'DELETE',
        url: 'https://api.example.com/users/1',
      };
      const curl = CurlGenerator.generate(data);
      expect(curl).toBe("curl -X DELETE 'https://api.example.com/users/1'");
    });
  });

  test.describe('formatAsOneLine()', () => {
    test('should convert multi-line curl to single line', () => {
      const multiLine =
        "curl -X GET 'url' \\\n  -H 'Accept: json' \\\n  -H 'Auth: token'";
      const result = CurlGenerator.formatAsOneLine(multiLine);
      expect(result).not.toContain('\n');
      expect(result).not.toContain('\\');
    });
  });

  test.describe('formatForDisplay()', () => {
    test('should return the same string (no-op)', () => {
      const input = "curl -X GET 'url'";
      expect(CurlGenerator.formatForDisplay(input)).toBe(input);
    });
  });
});
