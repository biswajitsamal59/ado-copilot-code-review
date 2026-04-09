import { AdoClient } from '../ado-api/client';
import { computeUnifiedDiff, formatWholeFile } from '../utils/diff';

const MAX_FILE_SIZE_BYTES = 250 * 1024; // 250 KB per file
const MAX_DIFF_LINES = 5000;
const CONCURRENCY = 5;
const CHUNK_BYTE_BUDGET = 150 * 1024; // 150 KB per chunk (~37K tokens)
const MAX_FILES_PER_CHUNK = 10;       // Cap file count — agent reads each file + checks impact

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

const CHANGE_LABELS: Record<string, string> = {
    add: 'Added', edit: 'Modified', delete: 'Deleted',
    rename: 'Renamed', copy: 'Copied',
};

function formatDate(dateStr: string): string {
    if (!dateStr) return 'N/A';
    try { return new Date(dateStr).toISOString().replace('T', ' ').substring(0, 16); }
    catch { return dateStr; }
}

/** Fetches the list of changed files for a PR iteration. */
export async function fetchIterationChanges(
    client: AdoClient, repo: string, prId: number, iterationId: number
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
    client: AdoClient, repo: string, filePath: string, commitId: string
): Promise<string | null> {
    try {
        const normalizedPath = encodeURIComponent(filePath.replace(/\\/g, '/'));
        const url = `${client.getCollectionUri()}/${client.getProject()}/_apis/git/repositories/${encodeURIComponent(repo)}/items?path=${normalizedPath}&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit&%24format=text&api-version=7.1`;
        const content = await client.getRawText(url);

        if (content.includes('\0')) return null; // Binary
        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE_BYTES) return null;
        return content;
    } catch {
        return null;
    }
}

/** Compute the diff for a single change entry. */
async function computeFileDiff(
    client: AdoClient, repo: string, entry: ChangeEntry,
    sourceCommitId: string, targetCommitId: string
): Promise<string> {
    const filePath = entry.item.path;

    if (entry.changeType === 'add') {
        const content = await fetchFileContent(client, repo, filePath, sourceCommitId);
        return content === null ? '(Binary file or file too large — content not shown)' : formatWholeFile(content, filePath, 'add');
    }

    if (entry.changeType === 'delete') {
        const content = await fetchFileContent(client, repo, filePath, targetCommitId);
        return content === null ? '(Binary file or file too large — content not shown)' : formatWholeFile(content, filePath, 'delete');
    }

    // edit, rename, or other
    const [newContent, oldContent] = await Promise.all([
        fetchFileContent(client, repo, filePath, sourceCommitId),
        fetchFileContent(client, repo, entry.originalPath ?? filePath, targetCommitId),
    ]);

    if (newContent === null || oldContent === null) {
        return '(Binary file or file too large — content not shown)';
    }

    const oldLineCount = oldContent.split('\n').length;
    const newLineCount = newContent.split('\n').length;
    if (oldLineCount > MAX_DIFF_LINES || newLineCount > MAX_DIFF_LINES) {
        return `(File too large for inline diff — ${oldLineCount}→${newLineCount} lines. Use git diff for full content.)`;
    }

    return computeUnifiedDiff(oldContent, newContent, filePath) || '(No text differences detected)';
}

/** Fetches diffs for all changed files with bounded concurrency. */
export async function fetchIterationDiffs(
    client: AdoClient, repo: string, prId: number, iterationId: number,
    changeEntries: ChangeEntry[], sourceCommitId: string, targetCommitId: string
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

/** Groups file diffs into chunks respecting both byte budget and file count cap. */
export function chunkDiffs(
    diffs: FileDiff[],
    byteBudget: number = CHUNK_BYTE_BUDGET,
    maxFiles: number = MAX_FILES_PER_CHUNK
): FileDiff[][] {
    if (diffs.length === 0) return [[]];

    const chunks: FileDiff[][] = [];
    let currentChunk: FileDiff[] = [];
    let currentBytes = 0;

    for (const diff of diffs) {
        const diffBytes = Buffer.byteLength(diff.diffContent, 'utf8');

        if (currentChunk.length > 0 && (currentBytes + diffBytes > byteBudget || currentChunk.length >= maxFiles)) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentBytes = 0;
        }

        currentChunk.push(diff);
        currentBytes += diffBytes;
    }

    if (currentChunk.length > 0) chunks.push(currentChunk);
    return chunks;
}

// ─── Text Formatting ──────────────────────────────────────────────────────────

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
    const sep = '='.repeat(80);
    const lines: string[] = [];

    const chunkLabel = chunkInfo ? ` (CHUNK ${chunkInfo.chunkIndex}/${chunkInfo.totalChunks})` : '';
    lines.push('', sep, `PULL REQUEST CHANGES - ITERATION #${iterationId}${chunkLabel}`, sep);

    // Iteration Details
    lines.push('', '[Iteration Details]');
    lines.push(`  Iteration ID:     #${iterationId}`);
    lines.push(`  Created:          ${formatDate(iteration.createdDate)}`);
    lines.push(`  Updated:          ${formatDate(iteration.updatedDate)}`);
    if (iteration.sourceRefCommit) lines.push(`  Source Commit:    ${iteration.sourceRefCommit.commitId.substring(0, 8)}`);
    if (iteration.targetRefCommit) lines.push(`  Target Commit:    ${iteration.targetRefCommit.commitId.substring(0, 8)}`);

    if (chunkInfo) {
        lines.push('');
        lines.push(`  ** Review Chunk:  ${chunkInfo.chunkIndex} of ${chunkInfo.totalChunks} **`);
        lines.push(`  ** This chunk contains ${changeEntries.length} of ${chunkInfo.totalFiles} total changed files **`);
        lines.push(`  ** Focus ONLY on the files listed below. Other files are reviewed in separate chunks. **`);
    }

    // Commits
    lines.push('', '[Commits in this PR]');
    if (commits.length > 0) {
        lines.push(`  Total commits: ${commits.length}`, '');
        for (const commit of commits) {
            let msg = (commit.comment ?? '').split('\n')[0];
            if (msg.length > 60) msg = msg.substring(0, 57) + '...';
            lines.push(`  ${commit.commitId.substring(0, 8)} - ${msg}`);
            lines.push(`           Author: ${commit.author?.name ?? ''} | ${formatDate(commit.author?.date ?? '')}`);
        }
    } else {
        lines.push('  No commits found.');
    }

    // Changed Files with Diffs
    lines.push('', '[Changed Files]');
    const nonTruncated = changeEntries.filter(c => c.changeType !== 'truncated');

    if (nonTruncated.length > 0) {
        const counts = { add: 0, edit: 0, delete: 0, other: 0 };
        for (const c of nonTruncated) {
            if (c.changeType in counts) (counts as Record<string, number>)[c.changeType]++;
            else counts.other++;
        }

        lines.push(`  Total files changed: ${nonTruncated.length}`);
        let summary = `  +${counts.add} added | ~${counts.edit} modified | -${counts.delete} deleted`;
        if (counts.other > 0) summary += ` | ${counts.other} other`;
        lines.push(summary);

        const diffMap = new Map(diffs.map(d => [d.path, d.diffContent]));

        for (const change of nonTruncated) {
            lines.push('');
            lines.push(`  [${CHANGE_LABELS[change.changeType] ?? change.changeType}] ${change.item.path}`);
            if (change.changeType === 'rename' && change.originalPath) {
                lines.push(`         (from: ${change.originalPath})`);
            }

            const diffContent = diffMap.get(change.item.path);
            if (diffContent) {
                lines.push('');
                for (const diffLine of diffContent.split('\n')) {
                    lines.push(`  ${diffLine}`);
                }
            }
        }

        const truncated = diffs.find(d => d.changeType === 'truncated');
        if (truncated) {
            lines.push('', `  ${truncated.diffContent}`);
        }
    } else {
        lines.push('  No file changes found in this iteration.');
    }

    lines.push('', sep);
    lines.push(`\nView PR: ${collectionUri.replace(/\/+$/, '')}/${project}/_git/${repo}/pullrequest/${prId}`);

    return lines.join('\n');
}
