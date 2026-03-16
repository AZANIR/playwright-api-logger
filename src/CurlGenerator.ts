/**
 * Curl command generator from HTTP request data
 * Converts captured request details into ready-to-use curl commands
 */

export interface RequestData {
  method: string;
  url: string;
  headers?: Record<string, string | string[]>;
  body?: any;
  params?: Record<string, string | number | boolean>;
  contentType?: string;
}

export class CurlGenerator {
  /**
   * Generate a curl command from request data
   * @param requestData - The request information to convert
   * @param maskAuth - Whether to mask Authorization headers (default: true)
   * @returns A properly formatted curl command string
   */
  static generate(requestData: RequestData, maskAuth: boolean = true): string {
    const { method, url, headers = {}, body, contentType } = requestData;

    let curl = `curl -X ${method.toUpperCase()} '${this.escapeUrl(url)}'`;

    // Detect content type
    const contentTypeHeader = this.getContentType(headers, contentType);

    // Add headers (except Content-Type for multipart, curl handles it)
    const headerEntries = this.normalizeHeaders(headers);
    for (const [key, value] of headerEntries) {
      // Skip Content-Type for multipart, curl generates it automatically with -F
      if (contentTypeHeader.includes('multipart') && key.toLowerCase() === 'content-type') {
        continue;
      }

      const headerValue = maskAuth && key.toLowerCase() === 'authorization'
        ? this.maskToken(value as string)
        : value;
      curl += ` -H '${key}: ${headerValue}'`;
    }

    // Add body for methods that typically have bodies
    if (body && this.shouldIncludeBody(method)) {
      if (contentTypeHeader.includes('multipart')) {
        // Multipart form data - use -F flag
        curl += this.generateMultipartFields(body);
      } else if (contentTypeHeader.includes('form-urlencoded')) {
        // URL-encoded form data - use --data
        const formString = this.bodyToFormString(body);
        curl += ` --data '${this.escapeBodyString(formString)}'`;
      } else {
        // JSON or other data - use --data with JSON
        const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
        curl += ` --data '${this.escapeBodyString(bodyString)}'`;
      }
    }

    return curl;
  }

  /**
   * Get content type from headers or contentType parameter
   */
  private static getContentType(headers: Record<string, string | string[]>, contentType?: string): string {
    if (contentType) {
      return contentType;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'content-type') {
        return Array.isArray(value) ? value[0] : value;
      }
    }

    return 'application/json';
  }

  /**
   * Convert body object to URL-encoded form string
   */
  private static bodyToFormString(body: any): string {
    if (typeof body === 'string') {
      return body;
    }

    const params = new URLSearchParams();
    if (typeof body === 'object' && body !== null) {
      for (const [key, value] of Object.entries(body)) {
        params.append(key, String(value));
      }
    }

    return params.toString();
  }

  /**
   * Generate multipart form fields for curl -F flag
   */
  private static generateMultipartFields(body: any): string {
    if (typeof body === 'string') {
      return ` --data '${this.escapeBodyString(body)}'`;
    }

    let result = '';
    if (typeof body === 'object' && body !== null) {
      for (const [key, value] of Object.entries(body)) {
        if (value && typeof value === 'object' && 'path' in value) {
          // File field - use -F 'key=@filepath'
          const filePath = (value as { path: string }).path;
          result += ` -F '${key}=@${filePath}'`;
        } else {
          // Regular field - use -F 'key=value'
          const fieldValue = String(value).replace(/'/g, "'\\''");
          result += ` -F '${key}=${fieldValue}'`;
        }
      }
    }

    return result || ` --data '${this.escapeBodyString(JSON.stringify(body))}'`;
  }

  /**
   * Escape URL special characters (except for safe URL characters)
   */
  private static escapeUrl(url: string): string {
    return url.replace(/"/g, '\\"');
  }

  /**
   * Escape string content in curl --data parameter
   */
  private static escapeBodyString(str: string): string {
    return str.replace(/'/g, "'\\''");
  }

  /**
   * Mask sensitive tokens/credentials (keep first 20 and last 10 chars)
   */
  private static maskToken(token: string): string {
    if (token.length <= 30) {
      return '***masked***';
    }
    const start = token.substring(0, 20);
    const end = token.substring(token.length - 10);
    return `${start}...${end}`;
  }

  /**
   * Normalize headers from various formats to array of tuples
   */
  private static normalizeHeaders(headers: Record<string, string | string[]>): Array<[string, string]> {
    const normalized: Array<[string, string]> = [];

    for (const [key, value] of Object.entries(headers)) {
      if (!value || this.shouldSkipHeader(key)) {
        continue;
      }

      const headerValue = Array.isArray(value) ? value.join(', ') : String(value);
      if (headerValue) {
        normalized.push([key, headerValue]);
      }
    }

    return normalized.sort((a, b) => a[0].localeCompare(b[0]));
  }

  /**
   * Determine if a header should be included in curl
   */
  private static shouldSkipHeader(headerName: string): boolean {
    const skipHeaders = [
      'connection',
      'content-length',
      'host',
      'origin',
      'referer',
      'user-agent',
    ];
    return skipHeaders.includes(headerName.toLowerCase());
  }

  /**
   * Determine if HTTP method typically includes a request body
   */
  private static shouldIncludeBody(method: string): boolean {
    const methodsWithBody = ['POST', 'PUT', 'PATCH'];
    return methodsWithBody.includes(method.toUpperCase());
  }

  /**
   * Format curl command for display (no-op, kept for API compatibility)
   */
  static formatForDisplay(curl: string): string {
    return curl;
  }

  /**
   * Format curl command as single line (for easy copying)
   */
  static formatAsOneLine(curl: string): string {
    return curl.replace(/\s+\\\n\s+/g, ' ');
  }
}
