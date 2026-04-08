import { AdoClient } from './client';

const STATUSES: Record<string, { code: number; api: string }> = {
    Active:  { code: 1, api: 'active' },
    Fixed:   { code: 2, api: 'fixed' },
    WontFix: { code: 3, api: 'wontFix' },
    Closed:  { code: 4, api: 'closed' },
    Pending: { code: 5, api: 'pending' },
};

export interface CreateCommentOptions {
    comment: string;
    status?: 'Active' | 'Fixed' | 'WontFix' | 'Closed' | 'Pending';
    filePath?: string;
    startLine?: number;
    endLine?: number;
    iterationId?: number;
    threadId?: number;  // If set, replies to existing thread instead of creating new one
}

export interface CreateCommentResult {
    threadId: number;
    commentId: number;
    author: string;
    publishedDate: string;
}

function normalizeFilePath(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function prBase(repo: string, prId: number): string {
    return `git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}`;
}

/**
 * Creates a new comment thread or replies to an existing thread.
 * For inline comments, falls back to a generic comment if the inline post fails.
 */
export async function createComment(
    client: AdoClient,
    repo: string,
    prId: number,
    options: CreateCommentOptions
): Promise<CreateCommentResult> {
    const { comment, status = 'Active', filePath, startLine, endLine, iterationId, threadId } = options;
    const base = prBase(repo, prId);

    // Reply to existing thread
    if (threadId && threadId > 0) {
        const url = `${base}/threads/${threadId}/comments`;
        const result = await client.post<{ id: number; author: { displayName: string }; publishedDate: string }>(url, {
            content: comment, parentCommentId: 0, commentType: 1,
        });
        return { threadId, commentId: result.id, author: result.author.displayName, publishedDate: result.publishedDate };
    }

    // Create new thread
    const threadsUrl = `${base}/threads`;
    const isInline = !!filePath && (startLine ?? 0) > 0;
    const effectiveEndLine = (endLine ?? 0) > 0 ? endLine! : (startLine ?? 0);

    const body: Record<string, unknown> = {
        comments: [{ content: comment, commentType: 1 }],
        status: STATUSES[status]?.code ?? 1,
    };

    if (isInline) {
        const normalizedPath = normalizeFilePath(filePath!);
        body.threadContext = {
            filePath: normalizedPath,
            rightFileStart: { line: startLine, offset: 1 },
            rightFileEnd: { line: effectiveEndLine, offset: 1 },
        };

        if ((iterationId ?? 0) > 0) {
            body.pullRequestThreadContext = {
                iterationContext: {
                    firstComparingIteration: iterationId,
                    secondComparingIteration: iterationId,
                },
            };
        }

        // Try inline first, fall back to generic comment on failure
        try {
            return extractResult(await client.post(threadsUrl, body));
        } catch (err) {
            console.warn(`Warning: Failed to post inline comment: ${(err as Error).message}`);
            console.warn('Falling back to generic PR comment with file/line information appended.');

            const lineInfo = startLine === effectiveEndLine ? `Line ${startLine}` : `Lines ${startLine}-${effectiveEndLine}`;
            const fallbackBody: Record<string, unknown> = {
                comments: [{ content: `${comment}\n\n**File:** \`${normalizedPath}\`\n**${lineInfo}**`, commentType: 1 }],
                status: STATUSES[status]?.code ?? 1,
            };
            return extractResult(await client.post(threadsUrl, fallbackBody));
        }
    }

    return extractResult(await client.post(threadsUrl, body));
}

function extractResult(result: { id: number; comments: Array<{ id: number; author: { displayName: string }; publishedDate: string }> }): CreateCommentResult {
    const first = result.comments[0];
    return { threadId: result.id, commentId: first.id, author: first.author.displayName, publishedDate: first.publishedDate };
}

/**
 * Updates a thread's status. Fails silently — always returns without throwing.
 */
export async function updateThreadStatus(
    client: AdoClient,
    repo: string,
    prId: number,
    threadId: number,
    status: string
): Promise<void> {
    try {
        const apiStatus = STATUSES[status]?.api ?? 'fixed';
        await client.patch(`${prBase(repo, prId)}/threads/${threadId}`, { status: apiStatus });
        console.log(`Thread #${threadId} status updated to '${status}'`);
    } catch (err) {
        console.warn(`Update-CopilotComment: Could not update thread #${threadId} — ${(err as Error).message}`);
    }
}

/**
 * Updates a comment's content. Fails silently.
 */
export async function updateCommentContent(
    client: AdoClient,
    repo: string,
    prId: number,
    threadId: number,
    commentId: number,
    content: string
): Promise<void> {
    try {
        await client.patch(`${prBase(repo, prId)}/threads/${threadId}/comments/${commentId}`, { content });
        console.log(`Comment #${commentId} in thread #${threadId} content updated`);
    } catch (err) {
        console.warn(`Update-CopilotComment: Could not update comment #${commentId} in thread #${threadId} — ${(err as Error).message}`);
    }
}

/**
 * Deletes a comment. Fails silently.
 */
export async function deleteComment(
    client: AdoClient,
    repo: string,
    prId: number,
    threadId: number,
    commentId: number
): Promise<void> {
    try {
        await client.delete(`${prBase(repo, prId)}/threads/${threadId}/comments/${commentId}`);
        console.log(`Comment #${commentId} in thread #${threadId} deleted`);
    } catch (err) {
        console.warn(`Delete-CopilotComment: Could not delete comment #${commentId} in thread #${threadId} — ${(err as Error).message}`);
    }
}
