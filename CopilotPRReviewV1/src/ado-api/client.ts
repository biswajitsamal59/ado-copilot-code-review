// ado-api/client.ts

export interface AdoClientConfig {
    collectionUri: string;   // e.g. "https://dev.azure.com/myorg"
    project: string;
    token: string;
    authType: 'Bearer' | 'Basic';
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
     * Core HTTP request using native fetch (Node 20+).
     * If path starts with 'http', it's used as an absolute URL (for file content).
     */
    async request<T>(
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        path: string,
        body?: Record<string, unknown>,
        options?: { accept?: string }
    ): Promise<T> {
        const accept = options?.accept ?? 'application/json';

        let fullUrl = path.startsWith('http') ? path : `${this.baseUrl}/${path.replace(/^\//, '')}`;
        if (!fullUrl.includes('api-version')) {
            fullUrl += (fullUrl.includes('?') ? '&' : '?') + 'api-version=7.1';
        }

        const headers: Record<string, string> = {
            'Authorization': this.authHeader,
            'Accept': accept,
        };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(fullUrl, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        const rawBody = await res.text();

        if (res.ok) {
            if (accept !== 'application/json' || rawBody.trim() === '') {
                return rawBody as unknown as T;
            }
            try {
                return JSON.parse(rawBody) as T;
            } catch {
                return rawBody as unknown as T;
            }
        }

        // Error response
        let apiMessage: string;
        try {
            const parsed = JSON.parse(rawBody);
            apiMessage = parsed.message ?? parsed.errorCode ?? rawBody.substring(0, 300);
        } catch {
            apiMessage = rawBody.substring(0, 300);
        }

        const base = `Azure DevOps API error (HTTP ${res.status}) calling ${method} ${fullUrl}`;
        if (res.status === 401) {
            throw new Error(`${base} — Authentication failed. Verify your token and permissions. API: ${apiMessage}`);
        } else if (res.status === 404) {
            throw new Error(`${base} — Resource not found. Verify org, project, repo, and PR ID. API: ${apiMessage}`);
        }
        throw new Error(`${base} — API: ${apiMessage}`);
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
