import { AdoClient } from './client';

// Status string to numeric value (matching ADO API)
const STATUS_MAP: Record<string, number> = {
    Active: 1,
    Fixed: 2,
    WontFix: 3,
    Closed: 4,
    Pending: 5,
};

// Status string to lowercase API value for PATCH
const STATUS_API_MAP: Record<string, string> = {
    Active: 'active',
    Fixed: 'fixed',
    WontFix: 'wontFix',
    Closed: 'closed',
    Pending: 'pending',
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

/**
 * Normalizes a file path: backslashes to forward slashes, ensures leading /.
 * Matches Format-AzureDevOpsFilePath from PowerShell.
 */
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
        return replyToThread(client, repo, prId, threadId, comment);
    }

    // Create new thread
    const threadsUrl = `${base}/threads`;
    const isInline = !!filePath && (startLine ?? 0) > 0;
    const effectiveEndLine = (endLine ?? 0) > 0 ? endLine! : (startLine ?? 0);

    const body: Record<string, unknown> = {
        comments: [{ content: comment, commentType: 1 }],
        status: STATUS_MAP[status] ?? 1,
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
    }

    // Try to post (inline or generic)
    let result: { id: number; comments: Array<{ id: number; author: { displayName: string }; publishedDate: string }> } | null = null;
    let inlineFailed = false;

    try {
        result = await client.post(threadsUrl, body);
    } catch (err) {
        if (isInline) {
            inlineFailed = true;
            console.warn(`Warning: Failed to post inline comment: ${(err as Error).message}`);
            console.warn('Falling back to generic PR comment with file/line information appended.');
        } else {
            throw err;
        }
    }

    // Fallback: post as generic comment with file/line appended
    if (isInline && (inlineFailed || result == null)) {
        const normalizedPath = normalizeFilePath(filePath!);
        const lineInfo = startLine === effectiveEndLine
            ? `Line ${startLine}`
            : `Lines ${startLine}-${effectiveEndLine}`;
        const fallbackComment = `${comment}\n\n**File:** \`${normalizedPath}\`\n**${lineInfo}**`;

        const fallbackBody: Record<string, unknown> = {
            comments: [{ content: fallbackComment, commentType: 1 }],
            status: STATUS_MAP[status] ?? 1,
        };
        result = await client.post(threadsUrl, fallbackBody);
    }

    if (!result) {
        throw new Error('Failed to create comment thread — API returned no result');
    }

    const firstComment = result.comments[0];
    return {
        threadId: result.id,
        commentId: firstComment.id,
        author: firstComment.author.displayName,
        publishedDate: firstComment.publishedDate,
    };
}

/**
 * Replies to an existing comment thread.
 */
async function replyToThread(
    client: AdoClient,
    repo: string,
    prId: number,
    threadId: number,
    comment: string
): Promise<CreateCommentResult> {
    const base = prBase(repo, prId);
    const url = `${base}/threads/${threadId}/comments`;
    const body = { content: comment, parentCommentId: 0, commentType: 1 };
    const result = await client.post<{ id: number; author: { displayName: string }; publishedDate: string }>(url, body);
    return {
        threadId,
        commentId: result.id,
        author: result.author.displayName,
        publishedDate: result.publishedDate,
    };
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
        const base = prBase(repo, prId);
        const apiStatus = STATUS_API_MAP[status] ?? 'fixed';
        await client.patch(`${base}/threads/${threadId}`, { status: apiStatus });
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
        const base = prBase(repo, prId);
        await client.patch(`${base}/threads/${threadId}/comments/${commentId}`, { content });
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
        const base = prBase(repo, prId);
        await client.delete(`${base}/threads/${threadId}/comments/${commentId}`);
        console.log(`Comment #${commentId} in thread #${threadId} deleted`);
    } catch (err) {
        console.warn(`Delete-CopilotComment: Could not delete comment #${commentId} in thread #${threadId} — ${(err as Error).message}`);
    }
}
