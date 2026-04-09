/**
 * Minimal unified diff generator using Myers diff algorithm.
 * A hard cap on edit distance prevents runaway memory/CPU when files are completely different.
 */

const MAX_EDIT_DISTANCE = 1500;

interface Edit {
    type: 'equal' | 'insert' | 'delete';
    oldLine?: number;
    newLine?: number;
    content: string;
}

/**
 * Shortest edit script via O(ND) Myers diff.
 * Returns null if edit distance exceeds MAX_EDIT_DISTANCE.
 */
function myersDiff(oldLines: string[], newLines: string[]): Edit[] | null {
    const n = oldLines.length;
    const m = newLines.length;
    const max = n + m;

    if (max === 0) return [];

    const v: number[] = new Array(2 * max + 1).fill(0);
    const trace: number[][] = [];
    const dLimit = Math.min(max, MAX_EDIT_DISTANCE);

    let found = false;
    for (let d = 0; d <= dLimit; d++) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
            const idx = k + max;
            let x: number;
            if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
                x = v[idx + 1];
            } else {
                x = v[idx - 1] + 1;
            }
            let y = x - k;
            while (x < n && y < m && oldLines[x] === newLines[y]) {
                x++;
                y++;
            }
            v[idx] = x;
            if (x >= n && y >= m) {
                found = true;
                break;
            }
        }
        if (found) break;
    }

    if (!found) return null;

    // Backtrack through trace to build edit list
    const edits: Edit[] = [];
    let x = n;
    let y = m;

    for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
        const vd = trace[d];
        const k = x - y;
        const idx = k + max;

        let prevK: number;
        if (k === -d || (k !== d && vd[idx - 1] < vd[idx + 1])) {
            prevK = k + 1;
        } else {
            prevK = k - 1;
        }

        const prevX = vd[prevK + max];
        const prevY = prevX - prevK;

        while (x > prevX && y > prevY) {
            x--;
            y--;
            edits.unshift({ type: 'equal', oldLine: x, newLine: y, content: oldLines[x] });
        }

        if (d > 0) {
            if (x === prevX) {
                y--;
                edits.unshift({ type: 'insert', newLine: y, content: newLines[y] });
            } else {
                x--;
                edits.unshift({ type: 'delete', oldLine: x, content: oldLines[x] });
            }
        }
    }

    return edits;
}

/** Group edits into hunks with context lines. */
function buildHunks(edits: Edit[], contextLines: number): Array<{
    oldStart: number; oldCount: number;
    newStart: number; newCount: number;
    lines: string[];
}> {
    const hunks: ReturnType<typeof buildHunks> = [];
    const changed = edits
        .map((e, i) => (e.type !== 'equal' ? i : -1))
        .filter(i => i >= 0);

    if (changed.length === 0) return [];

    const ranges: Array<[number, number]> = [];
    let start = Math.max(0, changed[0] - contextLines);
    let end = Math.min(edits.length - 1, changed[0] + contextLines);

    for (let ci = 1; ci < changed.length; ci++) {
        const next = changed[ci];
        if (next - contextLines <= end + 1) {
            end = Math.min(edits.length - 1, next + contextLines);
        } else {
            ranges.push([start, end]);
            start = Math.max(0, next - contextLines);
            end = Math.min(edits.length - 1, next + contextLines);
        }
    }
    ranges.push([start, end]);

    for (const [rangeStart, rangeEnd] of ranges) {
        const hunkEdits = edits.slice(rangeStart, rangeEnd + 1);
        const lines: string[] = [];
        let oldStart = -1;
        let oldCount = 0;
        let newStart = -1;
        let newCount = 0;

        for (const edit of hunkEdits) {
            if (edit.type === 'equal') {
                if (oldStart === -1) oldStart = (edit.oldLine ?? 0) + 1;
                if (newStart === -1) newStart = (edit.newLine ?? 0) + 1;
                lines.push(` ${edit.content}`);
                oldCount++;
                newCount++;
            } else if (edit.type === 'delete') {
                if (oldStart === -1) oldStart = (edit.oldLine ?? 0) + 1;
                if (newStart === -1) newStart = (edit.newLine !== undefined ? edit.newLine + 1 : oldStart);
                lines.push(`-${edit.content}`);
                oldCount++;
            } else {
                if (newStart === -1) newStart = (edit.newLine ?? 0) + 1;
                if (oldStart === -1) oldStart = (edit.oldLine !== undefined ? edit.oldLine + 1 : newStart);
                lines.push(`+${edit.content}`);
                newCount++;
            }
        }

        if (oldStart === -1) oldStart = 1;
        if (newStart === -1) newStart = 1;

        hunks.push({ oldStart, oldCount, newStart, newCount, lines });
    }

    return hunks;
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\//, '');
}

function splitLines(text: string): string[] {
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
}

/** Compute a unified diff between two file contents. */
export function computeUnifiedDiff(
    oldText: string,
    newText: string,
    filePath: string,
    contextLines = 3
): string {
    if (oldText === newText) return '';

    const p = normalizePath(filePath);
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);
    const edits = myersDiff(oldLines, newLines);

    // Fallback for files too different for meaningful line-level diff
    if (edits === null) {
        return [
            `--- a/${p}`, `+++ b/${p}`,
            `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
            ...oldLines.map(l => `-${l}`),
            ...newLines.map(l => `+${l}`),
        ].join('\n');
    }

    const hunks = buildHunks(edits, contextLines);
    if (hunks.length === 0) return '';

    const result = [`--- a/${p}`, `+++ b/${p}`];
    for (const hunk of hunks) {
        const oldRange = hunk.oldCount === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldCount}`;
        const newRange = hunk.newCount === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newCount}`;
        result.push(`@@ -${oldRange} +${newRange} @@`);
        result.push(...hunk.lines);
    }
    return result.join('\n');
}

/** Format an entire file as additions (new file) or deletions (deleted file). */
export function formatWholeFile(content: string, filePath: string, mode: 'add' | 'delete'): string {
    const p = normalizePath(filePath);
    const lines = splitLines(content);
    const prefix = mode === 'add' ? '+' : '-';
    const oldFile = mode === 'add' ? '/dev/null' : `a/${p}`;
    const newFile = mode === 'add' ? `b/${p}` : '/dev/null';
    const range = mode === 'add' ? `@@ -0,0 +1,${lines.length} @@` : `@@ -1,${lines.length} +0,0 @@`;
    return [`--- ${oldFile}`, `+++ ${newFile}`, range, ...lines.map(l => `${prefix}${l}`)].join('\n');
}
