import { AdoClient } from '../ado-api/client';
import { computeUnifiedDiff, formatAsAddition, formatAsDeletion } from '../utils/diff';

const MAX_FILE_SIZE_BYTES = 250 * 1024; // 250 KB per file
const MAX_DIFF_LINES = 5000; // Skip Myers diff for files larger than this
const CONCURRENCY = 5; // Parallel file fetches
const CHUNK_BYTE_BUDGET = 150 * 1024; // 150 KB per chunk (~37K tokens)

export interface ChangeEntry {
    changeType: string;
    item: { path: string; isFolder?: boolean };
    originalPath?: string;
}

export interface FileDiff {
    path: string;
    changeType: string;
    originalPath?: string;
    diffContent: string;
}

/**
 * Fetches the list of changed files for a PR iteration.
 */
export async function fetchIterationChanges(
    client: AdoClient,
    repo: string,
    prId: number,
    iterationId: number
): Promise<ChangeEntry[]> {
    const result = await client.get<{ changeEntries: ChangeEntry[] }>(
        `git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}/iterations/${iterationId}/changes`
    );
    return (result.changeEntries ?? []).filter(c => !c.item?.isFolder);
}

/**
 * Fetches the raw text content of a file at a specific commit.
 * Returns null if the file is binary, too large, or cannot be fetched.
 */
async function fetchFileContent(
    client: AdoClient,
    repo: string,
    filePath: string,
    commitId: string
): Promise<string | null> {
    try {
        const collectionUri = client.getCollectionUri();
        const project = client.getProject();
        const normalizedPath = filePath.replace(/\\/g, '/');
        const encodedPath = encodeURIComponent(normalizedPath);
        const url = `${collectionUri}/${project}/_apis/git/repositories/${encodeURIComponent(repo)}/items?path=${encodedPath}&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit&%24format=text&api-version=7.1`;

        const content = await client.getRawText(url);

        // Skip binary files (check for null bytes)
        if (content.includes('\0')) {
            return null;
        }

        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE_BYTES) {
            return null; // Too large
        }

        return content;
    } catch {
        return null;
    }
}

/**
 * Compute the diff for a single change entry.
 */
async function computeFileDiff(
    client: AdoClient,
    repo: string,
    entry: ChangeEntry,
    sourceCommitId: string,
    targetCommitId: string
): Promise<string> {
    const filePath = entry.item.path;
    const changeType = entry.changeType;

    if (changeType === 'add') {
        const content = await fetchFileContent(client, repo, filePath, sourceCommitId);
        if (content === null) return `(Binary file or file too large — content not shown)`;
        return formatAsAddition(content, filePath);
    }

    if (changeType === 'delete') {
        const content = await fetchFileContent(client, repo, filePath, targetCommitId);
        if (content === null) return `(Binary file or file too large — content not shown)`;
        return formatAsDeletion(content, filePath);
    }

    // edit, rename, or other
    const sourcePath = filePath;
    const targetPath = entry.originalPath ?? filePath;

    const [newContent, oldContent] = await Promise.all([
        fetchFileContent(client, repo, sourcePath, sourceCommitId),
        fetchFileContent(client, repo, targetPath, targetCommitId),
    ]);

    if (newContent === null || oldContent === null) {
        return `(Binary file or file too large — content not shown)`;
    }

    // Guard against very large files where Myers diff would be slow
    const oldLineCount = oldContent.split('\n').length;
    const newLineCount = newContent.split('\n').length;
    if (oldLineCount > MAX_DIFF_LINES || newLineCount > MAX_DIFF_LINES) {
        return `(File too large for inline diff — ${oldLineCount}→${newLineCount} lines. Use git diff for full content.)`;
    }

    const diff = computeUnifiedDiff(oldContent, newContent, filePath);
    return diff || '(No text differences detected)';
}

/**
 * Fetches diffs for all changed files in a PR iteration.
 * Uses bounded concurrency for parallel fetches. Returns ALL diffs with no cap.
 */
export async function fetchIterationDiffs(
    client: AdoClient,
    repo: string,
    prId: number,
    iterationId: number,
    changeEntries: ChangeEntry[],
    sourceCommitId: string,
    targetCommitId: string
): Promise<FileDiff[]> {
    const results: FileDiff[] = [];

    for (let i = 0; i < changeEntries.length; i += CONCURRENCY) {
        const batch = changeEntries.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
            batch.map(async (entry): Promise<FileDiff> => {
                try {
                    const diffContent = await computeFileDiff(client, repo, entry, sourceCommitId, targetCommitId);
                    return { path: entry.item.path, changeType: entry.changeType, originalPath: entry.originalPath, diffContent };
                } catch (err) {
                    return { path: entry.item.path, changeType: entry.changeType, originalPath: entry.originalPath, diffContent: `(Could not fetch diff: ${(err as Error).message})` };
                }
            })
        );
        results.push(...batchResults);
    }

    return results;
}

/**
 * Groups file diffs into chunks that each fit within the byte budget.
 * Each chunk is a self-contained set of FileDiff entries for one agent run.
 */
export function chunkDiffs(diffs: FileDiff[], byteBudget: number = CHUNK_BYTE_BUDGET): FileDiff[][] {
    if (diffs.length === 0) return [[]];

    const chunks: FileDiff[][] = [];
    let currentChunk: FileDiff[] = [];
    let currentBytes = 0;

    for (const diff of diffs) {
        const diffBytes = Buffer.byteLength(diff.diffContent, 'utf8');

        // If adding this diff exceeds the budget AND the chunk isn't empty, start a new chunk
        if (currentBytes + diffBytes > byteBudget && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentBytes = 0;
        }

        currentChunk.push(diff);
        currentBytes += diffBytes;
    }

    // Push the last chunk
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * Formats iteration data + diffs into the text matching current Iteration_Details.txt output,
 * but now includes actual diff content under each file.
 */
export interface ChunkInfo {
    chunkIndex: number;
    totalChunks: number;
    totalFiles: number;
}

export function formatIterationDetailsText(
    iterationId: number,
    iteration: { createdDate: string; updatedDate: string; sourceRefCommit?: { commitId: string }; targetRefCommit?: { commitId: string } },
    commits: Array<{ commitId: string; comment: string; author: { name: string; date: string } }>,
    changeEntries: ChangeEntry[],
    diffs: FileDiff[],
    collectionUri: string,
    project: string,
    repo: string,
    prId: number,
    chunkInfo?: ChunkInfo
): string {
    const sep80 = '='.repeat(80);
    const lines: string[] = [];

    const formatDate = (dateStr: string) => {
        if (!dateStr) return 'N/A';
        try {
            const d = new Date(dateStr);
            return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        } catch { return dateStr; }
    };

    const changeTypeLabel = (ct: string) => {
        switch (ct) {
            case 'add': return 'Added';
            case 'edit': return 'Modified';
            case 'delete': return 'Deleted';
            case 'rename': return 'Renamed';
            case 'copy': return 'Copied';
            default: return ct;
        }
    };

    lines.push('');
    lines.push(sep80);
    const chunkLabel = chunkInfo ? ` (CHUNK ${chunkInfo.chunkIndex}/${chunkInfo.totalChunks})` : '';
    lines.push(`PULL REQUEST CHANGES - ITERATION #${iterationId}${chunkLabel}`);
    lines.push(sep80);

    // Iteration Details
    lines.push('');
    lines.push('[Iteration Details]');
    lines.push(`  Iteration ID:     #${iterationId}`);
    lines.push(`  Created:          ${formatDate(iteration.createdDate)}`);
    lines.push(`  Updated:          ${formatDate(iteration.updatedDate)}`);
    if (iteration.sourceRefCommit) {
        lines.push(`  Source Commit:    ${iteration.sourceRefCommit.commitId.substring(0, 8)}`);
    }
    if (iteration.targetRefCommit) {
        lines.push(`  Target Commit:    ${iteration.targetRefCommit.commitId.substring(0, 8)}`);
    }
    if (chunkInfo) {
        lines.push('');
        lines.push(`  ** Review Chunk:  ${chunkInfo.chunkIndex} of ${chunkInfo.totalChunks} **`);
        lines.push(`  ** This chunk contains ${changeEntries.length} of ${chunkInfo.totalFiles} total changed files **`);
        lines.push(`  ** Focus ONLY on the files listed below. Other files are reviewed in separate chunks. **`);
    }

    // Commits
    lines.push('');
    lines.push('[Commits in this PR]');
    if (commits.length > 0) {
        lines.push(`  Total commits: ${commits.length}`);
        lines.push('');
        for (const commit of commits) {
            const shortId = commit.commitId.substring(0, 8);
            let msg = (commit.comment ?? '').split('\n')[0];
            if (msg.length > 60) msg = msg.substring(0, 57) + '...';
            lines.push(`  ${shortId} - ${msg}`);
            lines.push(`           Author: ${commit.author?.name ?? ''} | ${formatDate(commit.author?.date ?? '')}`);
        }
    } else {
        lines.push('  No commits found.');
    }

    // Changed Files with Diffs
    lines.push('');
    lines.push('[Changed Files]');
    const nonTruncated = changeEntries.filter(c => c.changeType !== 'truncated');
    if (nonTruncated.length > 0) {
        const addedCount = nonTruncated.filter(c => c.changeType === 'add').length;
        const modifiedCount = nonTruncated.filter(c => c.changeType === 'edit').length;
        const deletedCount = nonTruncated.filter(c => c.changeType === 'delete').length;
        const otherCount = nonTruncated.length - addedCount - modifiedCount - deletedCount;

        lines.push(`  Total files changed: ${nonTruncated.length}`);
        let summaryLine = `  +${addedCount} added | ~${modifiedCount} modified | -${deletedCount} deleted`;
        if (otherCount > 0) summaryLine += ` | ${otherCount} other`;
        lines.push(summaryLine);

        // Build a map of path -> diff
        const diffMap = new Map<string, string>();
        for (const d of diffs) {
            diffMap.set(d.path, d.diffContent);
        }

        for (const change of nonTruncated) {
            lines.push('');
            const label = changeTypeLabel(change.changeType);
            lines.push(`  [${label}] ${change.item.path}`);
            if (change.changeType === 'rename' && change.originalPath) {
                lines.push(`         (from: ${change.originalPath})`);
            }

            // Include diff content
            const diffContent = diffMap.get(change.item.path);
            if (diffContent) {
                lines.push('');
                for (const diffLine of diffContent.split('\n')) {
                    lines.push(`  ${diffLine}`);
                }
            }
        }

        // Truncation notice
        const truncated = diffs.find(d => d.changeType === 'truncated');
        if (truncated) {
            lines.push('');
            lines.push(`  ${truncated.diffContent}`);
        }
    } else {
        lines.push('  No file changes found in this iteration.');
    }

    lines.push('');
    lines.push(sep80);

    const collectionBase = collectionUri.replace(/\/+$/, '');
    lines.push(`\nView PR: ${collectionBase}/${project}/_git/${repo}/pullrequest/${prId}`);

    return lines.join('\n');
}
