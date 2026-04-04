import { AdoClient } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PrDetails {
    pullRequestId: number;
    title: string;
    status: string;
    repository: { name: string };
    sourceRefName: string;
    targetRefName: string;
    isDraft: boolean;
    mergeStatus: string;
    description: string;
    createdBy: { displayName: string; uniqueName: string };
    creationDate: string;
    closedBy?: { displayName: string };
    closedDate?: string;
    reviewers: Array<{
        displayName: string;
        vote: number;
        isRequired: boolean;
    }>;
}

export interface PrThread {
    id: number;
    status: string;
    threadContext?: {
        filePath?: string;
        rightFileStart?: { line: number };
        leftFileStart?: { line: number };
    };
    comments: Array<{
        id: number;
        content: string;
        commentType: string;
        author: { displayName: string; uniqueName: string };
        publishedDate: string;
    }>;
}

export interface PrIteration {
    id: number;
    createdDate: string;
    updatedDate: string;
    sourceRefCommit?: { commitId: string };
    targetRefCommit?: { commitId: string };
}

export interface PrCommit {
    commitId: string;
    comment: string;
    author: { name: string; date: string };
}

export interface CopilotThread {
    threadId: number;
    status: string;
    filePath: string | null;
    startLine: number | null;
    content: string;
    replies: Array<{ author: string; content: string; publishedDate: string }>;
}

// ─── API Fetchers ─────────────────────────────────────────────────────────────

export async function fetchPrDetails(
    client: AdoClient,
    repo: string,
    prId: number
): Promise<PrDetails> {
    return client.get<PrDetails>(
        `git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}`
    );
}

export async function fetchPrWorkItemIds(
    client: AdoClient,
    repo: string,
    prId: number
): Promise<number[]> {
    const result = await client.get<{ value: Array<{ id: number }> }>(
        `git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/workitems`
    );
    return (result.value ?? []).map(wi => wi.id);
}

export async function fetchPrIterations(
    client: AdoClient,
    repo: string,
    prId: number
): Promise<PrIteration[]> {
    const result = await client.get<{ value: PrIteration[] }>(
        `git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/iterations`
    );
    return result.value ?? [];
}

export async function fetchPrThreads(
    client: AdoClient,
    repo: string,
    prId: number
): Promise<PrThread[]> {
    const result = await client.get<{ value: PrThread[] }>(
        `git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/threads`
    );
    return result.value ?? [];
}

export async function fetchPrCommits(
    client: AdoClient,
    repo: string,
    prId: number
): Promise<PrCommit[]> {
    const result = await client.get<{ value: PrCommit[] }>(
        `git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/commits`
    );
    return result.value ?? [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    if (!dateStr) return 'N/A';
    try {
        const d = new Date(dateStr);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    } catch {
        return dateStr;
    }
}

function branchShortName(refName: string): string {
    return (refName ?? '').replace(/^refs\/heads\//, '');
}

function voteLabel(vote: number): string {
    switch (vote) {
        case 10: return 'Approved';
        case 5: return 'Approved with suggestions';
        case 0: return 'No vote';
        case -5: return 'Waiting for author';
        case -10: return 'Rejected';
        default: return 'Unknown';
    }
}

// ─── Copilot Thread Filtering ─────────────────────────────────────────────────

/**
 * Filters threads to those created by the Copilot review agent.
 * Matches by Build Service author OR comment containing a known attribution tag.
 */
export function filterCopilotThreads(threads: PrThread[]): CopilotThread[] {
    const commentThreads = threads.filter(t =>
        t.comments &&
        t.comments.length > 0 &&
        t.comments[0].commentType !== 'system'
    );

    const copilotThreads = commentThreads.filter(t => {
        const firstComment = t.comments[0];
        const isBuildService =
            (firstComment.author.displayName ?? '').toLowerCase().includes('build service') ||
            (firstComment.author.uniqueName ?? '').toLowerCase().includes('build service');
        const hasTag =
            (firstComment.content ?? '').includes('[Generated by GitHub Copilot]') ||
            (firstComment.content ?? '').includes('[Generated by Claude Code]');
        return isBuildService || hasTag;
    });

    return copilotThreads.map(t => {
        const firstComment = t.comments[0];
        let filePath: string | null = null;
        let startLine: number | null = null;

        if (t.threadContext?.filePath) {
            filePath = t.threadContext.filePath;
            if (t.threadContext.rightFileStart?.line) {
                startLine = t.threadContext.rightFileStart.line;
            } else if (t.threadContext.leftFileStart?.line) {
                startLine = t.threadContext.leftFileStart.line;
            }
        }

        const replies = t.comments.slice(1)
            .filter(c => c.commentType !== 'system')
            .map(c => ({
                author: c.author.displayName,
                content: c.content,
                publishedDate: c.publishedDate,
            }));

        return {
            threadId: t.id,
            status: t.status,
            filePath,
            startLine,
            content: firstComment.content,
            replies,
        };
    });
}

// ─── Text Formatting ──────────────────────────────────────────────────────────

/**
 * Formats all PR data into the text format matching current PR_Details.txt output.
 */
export function formatPrDetailsText(
    pr: PrDetails,
    threads: PrThread[],
    iterations: PrIteration[],
    workItemIds: number[],
    copilotThreads: CopilotThread[],
    collectionUri: string
): string {
    const sep80 = '='.repeat(80);
    const lines: string[] = [];

    lines.push('');
    lines.push(sep80);
    lines.push('PULL REQUEST DETAILS');
    lines.push(sep80);

    // Basic Information
    lines.push('');
    lines.push('[Basic Information]');
    lines.push(`  ID:              #${pr.pullRequestId}`);
    lines.push(`  Title:           ${pr.title}`);
    lines.push(`  Status:          ${(pr.status ?? '').toUpperCase()}`);
    lines.push(`  Repository:      ${pr.repository?.name ?? ''}`);
    lines.push(`  Source Branch:   ${branchShortName(pr.sourceRefName)}`);
    lines.push(`  Target Branch:   ${branchShortName(pr.targetRefName)}`);
    lines.push(`  Is Draft:        ${pr.isDraft}`);
    lines.push(`  Merge Status:    ${pr.mergeStatus ?? ''}`);

    // People
    lines.push('');
    lines.push('[People]');
    lines.push(`  Created By:      ${pr.createdBy?.displayName ?? ''} <${pr.createdBy?.uniqueName ?? ''}>`);
    lines.push(`  Created Date:    ${formatDate(pr.creationDate)}`);
    if (pr.closedBy) {
        lines.push(`  Closed By:       ${pr.closedBy.displayName}`);
        if (pr.closedDate) lines.push(`  Closed Date:     ${formatDate(pr.closedDate)}`);
    }

    // Reviewers
    lines.push('');
    lines.push('[Reviewers]');
    if (pr.reviewers && pr.reviewers.length > 0) {
        for (const r of pr.reviewers) {
            const required = r.isRequired ? ' (Required)' : '';
            lines.push(`  - ${r.displayName}${required} : ${voteLabel(r.vote)}`);
        }
    } else {
        lines.push('  No reviewers assigned');
    }

    // Description
    lines.push('');
    lines.push('[Description]');
    if (!pr.description) {
        lines.push('  (No description provided)');
    } else {
        const desc = pr.description.replace(/\r\n/g, '\n');
        for (const line of desc.split('\n')) {
            lines.push(`  ${line}`);
        }
    }

    // Iterations
    lines.push('');
    lines.push('[Iterations/Updates]');
    if (iterations && iterations.length > 0) {
        lines.push(`  Total iterations: ${iterations.length}`);
        const last = iterations[iterations.length - 1];
        if (last) {
            lines.push(`  Last updated:     ${formatDate(last.updatedDate)}`);
        }
    }

    // Comment Threads
    lines.push('');
    lines.push('[Comments/Threads]');
    const commentThreads = threads.filter(t =>
        t.comments && t.comments.length > 0 && t.comments[0].commentType !== 'system'
    );
    const activeCount = commentThreads.filter(t => t.status === 'active').length;
    const resolvedCount = commentThreads.filter(t => t.status === 'fixed' || t.status === 'closed').length;
    lines.push(`  Active threads:   ${activeCount}`);
    lines.push(`  Resolved threads: ${resolvedCount}`);

    if (commentThreads.length > 0) {
        lines.push('');
        lines.push('  --- Top-Level Comments ---');
        for (const thread of commentThreads) {
            const first = thread.comments[0];
            const statusLabel = (() => {
                switch (thread.status) {
                    case 'active': return 'Active';
                    case 'fixed': return 'Resolved';
                    case 'closed': return 'Closed';
                    case 'wontFix': return "Won't Fix";
                    case 'pending': return 'Pending';
                    case 'byDesign': return 'By Design';
                    default: return thread.status ?? '';
                }
            })();

            lines.push('');
            lines.push(`  Thread #${thread.id} [${statusLabel}]`);

            if (thread.threadContext?.filePath) {
                const lineInfo = thread.threadContext.rightFileStart
                    ? ` (Line ${thread.threadContext.rightFileStart.line})`
                    : thread.threadContext.leftFileStart
                        ? ` (Line ${thread.threadContext.leftFileStart.line})`
                        : '';
                lines.push(`  File: ${thread.threadContext.filePath}${lineInfo}`);
            }

            lines.push(`  Author: ${first.author.displayName} | ${formatDate(first.publishedDate)}`);

            if (first.content) {
                const contentLines = first.content.split('\n');
                const displayLines = contentLines.slice(0, 30);
                for (const l of displayLines) {
                    const trimmed = l.trim();
                    if (trimmed) lines.push(`    ${trimmed}`);
                }
                if (contentLines.length > 3) {
                    lines.push(`    ... (${contentLines.length - 3} more lines)`);
                }
            }

            const replyCount = thread.comments.length - 1;
            if (replyCount > 0) {
                lines.push(`    [${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}]`);
            }
        }
    }

    // Linked Work Items
    lines.push('');
    lines.push('[Linked Work Items]');
    if (workItemIds.length > 0) {
        const collectionBase = collectionUri.replace(/\/+$/, '');
        for (const id of workItemIds) {
            lines.push(`  - #${id}: ${collectionBase}/${pr.repository?.name}/_workitems/edit/${id}`);
        }
    } else {
        lines.push('  No linked work items');
    }

    // Links
    lines.push('');
    lines.push('[Links]');
    const collectionBase = collectionUri.replace(/\/+$/, '');
    lines.push(`  Web URL: ${collectionBase}/${pr.repository?.name ?? ''}/pullrequest/${pr.pullRequestId}`);

    lines.push('');
    lines.push(sep80);

    // Copilot Comment Threads JSON section
    if (copilotThreads.length > 0) {
        lines.push('');
        lines.push('=== COPILOT COMMENT THREADS (JSON) ===');
        lines.push(JSON.stringify(copilotThreads));
        lines.push('=== END COPILOT COMMENT THREADS ===');
    }

    return lines.join('\n');
}
