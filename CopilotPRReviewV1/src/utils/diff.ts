/**
 * Minimal unified diff generator using Myers diff algorithm (edit graph).
 * Produces standard unified diff format with @@ hunks.
 */

interface Edit {
    type: 'equal' | 'insert' | 'delete';
    oldLine?: number;
    newLine?: number;
    content: string;
}

/**
 * Compute the shortest edit script between two arrays of lines using
 * the simple O(ND) Myers diff algorithm.
 */
function myersDiff(oldLines: string[], newLines: string[]): Edit[] {
    const n = oldLines.length;
    const m = newLines.length;
    const max = n + m;

    if (max === 0) return [];

    // v[k] = furthest x reached on diagonal k
    const v: number[] = new Array(2 * max + 1).fill(0);
    // trace[d] = snapshot of v at depth d
    const trace: number[][] = [];

    outer:
    for (let d = 0; d <= max; d++) {
        trace.push([...v]);
        for (let k = -d; k <= d; k += 2) {
            const idx = k + max;
            let x: number;
            if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
                x = v[idx + 1]; // move down
            } else {
                x = v[idx - 1] + 1; // move right
            }
            let y = x - k;
            while (x < n && y < m && oldLines[x] === newLines[y]) {
                x++;
                y++;
            }
            v[idx] = x;
            if (x >= n && y >= m) {
                // Found shortest path — backtrack
                break outer;
            }
        }
    }

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
            prevK = k + 1; // came from down
        } else {
            prevK = k - 1; // came from right
        }

        const prevX = vd[prevK + max];
        const prevY = prevX - prevK;

        // Snake: equal lines
        while (x > prevX && y > prevY) {
            x--;
            y--;
            edits.unshift({ type: 'equal', oldLine: x, newLine: y, content: oldLines[x] });
        }

        if (d > 0) {
            if (x === prevX) {
                // Insert from new
                y--;
                edits.unshift({ type: 'insert', newLine: y, content: newLines[y] });
            } else {
                // Delete from old
                x--;
                edits.unshift({ type: 'delete', oldLine: x, content: oldLines[x] });
            }
        }
    }

    return edits;
}

/**
 * Group edits into hunks with context lines.
 */
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

    // Group changed edit indices into ranges with context
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

/**
 * Compute a unified diff between two file contents.
 *
 * @param oldText  Original file content
 * @param newText  New file content
 * @param filePath File path for the diff header (e.g. '/src/App.cs')
 * @param contextLines Number of context lines around changes (default 3)
 * @returns Unified diff string, or empty string if files are identical
 */
export function computeUnifiedDiff(
    oldText: string,
    newText: string,
    filePath: string,
    contextLines = 3
): string {
    if (oldText === newText) return '';

    const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    // Remove trailing empty line artifact from split if file ends with \n
    if (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') oldLines.pop();
    if (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop();

    const edits = myersDiff(oldLines, newLines);
    const hunks = buildHunks(edits, contextLines);

    if (hunks.length === 0) return '';

    const result: string[] = [
        `--- a/${normalizedPath}`,
        `+++ b/${normalizedPath}`,
    ];

    for (const hunk of hunks) {
        const oldRange = hunk.oldCount === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldCount}`;
        const newRange = hunk.newCount === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newCount}`;
        result.push(`@@ -${oldRange} +${newRange} @@`);
        result.push(...hunk.lines);
    }

    return result.join('\n');
}

/**
 * Format all lines of a file as additions (for new files).
 */
export function formatAsAddition(content: string, filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const result: string[] = [
        `--- /dev/null`,
        `+++ b/${normalizedPath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map(l => `+${l}`),
    ];
    return result.join('\n');
}

/**
 * Format all lines of a file as deletions (for deleted files).
 */
export function formatAsDeletion(content: string, filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const result: string[] = [
        `--- a/${normalizedPath}`,
        `+++ /dev/null`,
        `@@ -1,${lines.length} +0,0 @@`,
        ...lines.map(l => `-${l}`),
    ];
    return result.join('\n');
}
