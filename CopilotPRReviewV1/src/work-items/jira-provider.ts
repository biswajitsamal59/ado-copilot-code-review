import * as https from 'https';
import { URL } from 'url';
import { WorkItemProvider } from './provider';
import { WorkItemDetails } from './types';

export interface JiraConfig {
    baseUrl: string;   // e.g. "https://myorg.atlassian.net"
    email: string;
    apiToken: string;
}

interface JiraIssueResponse {
    key: string;
    fields: {
        summary: string;
        status: { name: string };
        issuetype: { name: string };
        description?: Record<string, unknown> | null;
        [customFieldId: string]: unknown;
    };
}

/**
 * Converts Atlassian Document Format (ADF) to plain text.
 * Recursively walks the ADF JSON tree, extracting text nodes and inserting newlines at paragraphs/breaks.
 */
function adfToText(adfNode: unknown): string {
    if (!adfNode || typeof adfNode !== 'object') return '';

    const node = adfNode as Record<string, unknown>;
    const text: string[] = [];

    // If this node has text content, collect it
    if (typeof node.text === 'string') {
        text.push(node.text);
    }

    // If this node has content array (paragraph, doc, etc.), recurse
    if (Array.isArray(node.content)) {
        const contentTexts = (node.content as unknown[])
            .map(child => adfToText(child))
            .filter(s => s.length > 0);
        text.push(...contentTexts);
    }

    // Insert newline at paragraph and hardBreak boundaries
    if (node.type === 'paragraph' || node.type === 'hardBreak') {
        return text.join('') + '\n';
    }

    return text.join('');
}

/**
 * JIRA Cloud REST API implementation of WorkItemProvider.
 */
export class JiraProvider implements WorkItemProvider {
    private readonly baseUrl: string;
    private readonly authHeader: string;

    constructor(private readonly config: JiraConfig) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
        const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
        this.authHeader = `Basic ${credentials}`;
    }

    extractIds(prDescription: string): string[] {
        // Match JIRA ticket keys: 2+ uppercase letters, optionally followed by uppercase/digits/underscores, then hyphen, then digits
        const matches = prDescription.match(/\b([A-Z]{2,}[A-Z0-9_]*-\d+)\b/g) ?? [];
        return [...new Set(matches)]; // deduplicate
    }

    async fetchDetails(ids: string[]): Promise<WorkItemDetails[]> {
        if (ids.length === 0) return [];

        // Fetch all issues in parallel, but don't fail the whole batch if one fails
        const results = await Promise.allSettled(
            ids.map(id => this.fetchIssue(id))
        );

        return results
            .filter((r): r is PromiseFulfilledResult<WorkItemDetails> => r.status === 'fulfilled')
            .map(r => r.value);
    }

    private async fetchIssue(key: string): Promise<WorkItemDetails> {
        const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,issuetype,description,customfield_10016`;
        const response = await this.request<JiraIssueResponse>(url);

        const fields = response.fields;
        const acceptanceCriteria = fields['customfield_10016']
            ? adfToText(fields['customfield_10016']).trim()
            : '';

        return {
            id: response.key,
            type: fields.issuetype?.name ?? 'Unknown',
            title: fields.summary ?? '',
            state: fields.status?.name ?? 'Unknown',
            description: fields.description ? adfToText(fields.description).trim() : '',
            acceptanceCriteria,
            reproSteps: '',
        };
    }

    private async request<T>(url: string): Promise<T> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const req = https.request(
                {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || 443,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    headers: {
                        'Authorization': this.authHeader,
                        'Accept': 'application/json',
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf8');
                        const statusCode = res.statusCode ?? 0;

                        if (statusCode >= 200 && statusCode < 300) {
                            try {
                                resolve(JSON.parse(body) as T);
                            } catch {
                                reject(new Error(`Failed to parse JIRA response: ${body.substring(0, 100)}`));
                            }
                            return;
                        }

                        let errorMsg: string;
                        try {
                            const parsed = JSON.parse(body) as Record<string, unknown>;
                            errorMsg = (parsed.message as string) ?? JSON.stringify(parsed).substring(0, 200);
                        } catch {
                            errorMsg = body.substring(0, 200);
                        }

                        reject(new Error(`JIRA API error (HTTP ${statusCode}): ${errorMsg}`));
                    });
                }
            );

            req.on('error', (err) => {
                reject(new Error(`Failed to fetch from JIRA: ${err.message}`));
            });

            req.end();
        });
    }
}
