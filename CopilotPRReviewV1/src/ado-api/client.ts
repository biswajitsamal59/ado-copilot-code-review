// D:/GitHub/ado-copilot-code-review/CopilotPRReviewV1/src/ado-api/client.ts

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface AdoClientConfig {
    collectionUri: string;   // e.g. "https://dev.azure.com/myorg"
    project: string;
    token: string;
    authType: 'Bearer' | 'Basic';
}

export class AdoApiError extends Error {
    constructor(
        public readonly statusCode: number | undefined,
        public readonly method: string,
        public readonly url: string,
        public readonly apiMessage: string | undefined,
        message: string
    ) {
        super(message);
        this.name = 'AdoApiError';
    }
}

export class AdoClient {
    private readonly baseUrl: string;
    private readonly authHeader: string;

    constructor(private readonly config: AdoClientConfig) {
        // Normalize: strip trailing slash
        const uri = config.collectionUri.replace(/\/+$/, '');
        this.baseUrl = `${uri}/${config.project}/_apis`;

        if (config.authType === 'Bearer') {
            this.authHeader = `Bearer ${config.token}`;
        } else {
            // PAT: base64 encode ":token" (matching PowerShell: ":$Token")
            const encoded = Buffer.from(`:${config.token}`).toString('base64');
            this.authHeader = `Basic ${encoded}`;
        }
    }

    // Build full URL. If path starts with http, use as-is (absolute URL support for work items endpoint)
    private buildUrl(path: string): string {
        const url = path.startsWith('http') ? path : `${this.baseUrl}/${path.replace(/^\//, '')}`;
        // Append api-version if not already present
        const sep = url.includes('?') ? '&' : '?';
        return url.includes('api-version') ? url : `${url}${sep}api-version=7.1`;
    }

    private getHeaders(extra?: Record<string, string>): Record<string, string> {
        return {
            'Authorization': this.authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...extra,
        };
    }

    async request<T>(
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        path: string,
        body?: Record<string, unknown>
    ): Promise<T> {
        const fullUrl = this.buildUrl(path);
        const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
        const headers = this.getHeaders(
            bodyStr !== undefined ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}
        );

        return new Promise<T>((resolve, reject) => {
            const url = new URL(fullUrl);
            const lib = url.protocol === 'https:' ? https : http;
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method,
                headers,
            };

            const req = lib.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const rawBody = Buffer.concat(chunks).toString('utf8');
                    const statusCode = res.statusCode ?? 0;

                    if (statusCode >= 200 && statusCode < 300) {
                        if (method === 'DELETE' || rawBody.trim() === '') {
                            resolve(undefined as unknown as T);
                            return;
                        }
                        try {
                            resolve(JSON.parse(rawBody) as T);
                        } catch {
                            resolve(rawBody as unknown as T);
                        }
                        return;
                    }

                    // Error response
                    let apiMessage: string | undefined;
                    try {
                        const parsed = JSON.parse(rawBody);
                        apiMessage = parsed.message ?? parsed.errorCode ?? rawBody.substring(0, 300);
                    } catch {
                        apiMessage = rawBody.substring(0, 300);
                    }

                    let msg: string;
                    const base = `Azure DevOps API error (HTTP ${statusCode}) calling ${method} ${fullUrl}`;
                    if (statusCode === 401) {
                        msg = `${base} — Authentication failed. Please verify your token is valid and has appropriate permissions. API response: ${apiMessage}`;
                    } else if (statusCode === 404) {
                        msg = `${base} — Resource not found. Please verify the organization, project, repository, and PR ID. API response: ${apiMessage}`;
                    } else if (statusCode === 400) {
                        msg = `${base} — Bad request. API response: ${apiMessage}`;
                    } else {
                        msg = `${base} — API response: ${apiMessage}`;
                    }
                    reject(new AdoApiError(statusCode, method, fullUrl, apiMessage, msg));
                });
            });

            req.on('error', (err) => {
                reject(new AdoApiError(undefined, method, fullUrl, undefined,
                    `Network error calling ${method} ${fullUrl} — ${err.message}`));
            });

            if (bodyStr !== undefined) {
                req.write(bodyStr);
            }
            req.end();
        });
    }

    async get<T>(path: string): Promise<T> {
        return this.request<T>('GET', path);
    }

    async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
        return this.request<T>('POST', path, body);
    }

    async patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
        return this.request<T>('PATCH', path, body);
    }

    async delete(path: string): Promise<void> {
        await this.request<void>('DELETE', path);
    }

    /**
     * Fetches a URL and returns the raw text body (Accept: text/plain).
     * Used for fetching file content from the Git Items API.
     * Pass an absolute URL (including api-version) directly.
     */
    async getRawText(absoluteUrl: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(absoluteUrl);
            const lib = parsedUrl.protocol === 'https:' ? https : http;
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Accept': 'text/plain',
                },
            };

            const req = lib.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const statusCode = res.statusCode ?? 0;
                    if (statusCode >= 200 && statusCode < 300) {
                        resolve(Buffer.concat(chunks).toString('utf8'));
                    } else {
                        reject(new AdoApiError(statusCode, 'GET', absoluteUrl, undefined,
                            `HTTP ${statusCode} fetching raw content from ${absoluteUrl}`));
                    }
                });
            });
            req.on('error', (err) => {
                reject(new AdoApiError(undefined, 'GET', absoluteUrl, undefined,
                    `Network error fetching ${absoluteUrl} — ${err.message}`));
            });
            req.end();
        });
    }

    // Get the collection URI without project suffix (for work items API and other collection-level APIs)
    getCollectionUri(): string {
        return this.config.collectionUri.replace(/\/+$/, '');
    }

    getProject(): string {
        return this.config.project;
    }
}
