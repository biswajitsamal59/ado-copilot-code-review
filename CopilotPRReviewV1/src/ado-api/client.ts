// ado-api/client.ts

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
        const uri = config.collectionUri.replace(/\/+$/, '');
        this.baseUrl = `${uri}/${config.project}/_apis`;

        if (config.authType === 'Bearer') {
            this.authHeader = `Bearer ${config.token}`;
        } else {
            const encoded = Buffer.from(`:${config.token}`).toString('base64');
            this.authHeader = `Basic ${encoded}`;
        }
    }

    /**
     * Core HTTP request. Handles both JSON API calls and raw text fetches.
     * If path starts with 'http', it's used as an absolute URL (for work items, file content).
     */
    async request<T>(
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        path: string,
        body?: Record<string, unknown>,
        options?: { accept?: string }
    ): Promise<T> {
        const accept = options?.accept ?? 'application/json';
        const isRawText = accept !== 'application/json';

        // Build URL: absolute if starts with http, otherwise relative to baseUrl
        let fullUrl = path.startsWith('http') ? path : `${this.baseUrl}/${path.replace(/^\//, '')}`;
        if (!fullUrl.includes('api-version')) {
            fullUrl += (fullUrl.includes('?') ? '&' : '?') + 'api-version=7.1';
        }

        const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
        const headers: Record<string, string> = {
            'Authorization': this.authHeader,
            'Accept': accept,
        };
        if (bodyStr !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
        }

        return new Promise<T>((resolve, reject) => {
            const url = new URL(fullUrl);
            const lib = url.protocol === 'https:' ? https : http;

            const req = lib.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method,
                headers,
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const rawBody = Buffer.concat(chunks).toString('utf8');
                    const statusCode = res.statusCode ?? 0;

                    if (statusCode >= 200 && statusCode < 300) {
                        if (isRawText || method === 'DELETE' || rawBody.trim() === '') {
                            resolve(rawBody as unknown as T);
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

                    const base = `Azure DevOps API error (HTTP ${statusCode}) calling ${method} ${fullUrl}`;
                    let msg: string;
                    if (statusCode === 401) {
                        msg = `${base} — Authentication failed. Verify your token and permissions. API: ${apiMessage}`;
                    } else if (statusCode === 404) {
                        msg = `${base} — Resource not found. Verify org, project, repo, and PR ID. API: ${apiMessage}`;
                    } else {
                        msg = `${base} — API: ${apiMessage}`;
                    }
                    reject(new AdoApiError(statusCode, method, fullUrl, apiMessage, msg));
                });
            });

            req.on('error', (err) => {
                reject(new AdoApiError(undefined, method, fullUrl, undefined,
                    `Network error calling ${method} ${fullUrl} — ${err.message}`));
            });

            if (bodyStr !== undefined) req.write(bodyStr);
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
     * Fetches a URL and returns the raw text body.
     * Used for fetching file content from the Git Items API.
     */
    async getRawText(absoluteUrl: string): Promise<string> {
        return this.request<string>('GET', absoluteUrl, undefined, { accept: 'text/plain' });
    }

    getCollectionUri(): string {
        return this.config.collectionUri.replace(/\/+$/, '');
    }

    getProject(): string {
        return this.config.project;
    }
}
