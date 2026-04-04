#!/usr/bin/env node
/**
 * Standalone CLI script called by the AI agent to update PR comment threads.
 * Replaces Update-CopilotComment.ps1.
 * Fails silently — always exits 0.
 *
 * Usage:
 *   node update-comment.js --thread-id 123 --status Fixed
 *   node update-comment.js --thread-id 123 --comment-id 456 --content "Updated text"
 *
 * Environment variables: AZUREDEVOPS_TOKEN, AZUREDEVOPS_AUTH_TYPE,
 *   AZUREDEVOPS_COLLECTION_URI, PROJECT, REPOSITORY, PRID
 */

import { AdoClient } from '../ado-api/client';
import { updateThreadStatus, updateCommentContent } from '../ado-api/comments';

function parseArgs(argv: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--') && i + 1 < argv.length) {
            const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            result[key] = argv[++i];
        }
    }
    return result;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const threadId = parseInt(args['threadId'] ?? '0', 10);

    if (!threadId) {
        console.warn('Update-CopilotComment: --thread-id is required');
        return;
    }

    const token = process.env['AZUREDEVOPS_TOKEN'];
    const authType = (process.env['AZUREDEVOPS_AUTH_TYPE'] ?? 'Basic') as 'Bearer' | 'Basic';
    const collectionUri = process.env['AZUREDEVOPS_COLLECTION_URI'];
    const project = process.env['PROJECT'];
    const repository = process.env['REPOSITORY'];
    const prId = process.env['PRID'];

    if (!token || !collectionUri || !project || !repository || !prId) {
        const missing = [
            !token && 'AZUREDEVOPS_TOKEN',
            !collectionUri && 'AZUREDEVOPS_COLLECTION_URI',
            !project && 'PROJECT',
            !repository && 'REPOSITORY',
            !prId && 'PRID',
        ].filter(Boolean);
        console.warn(`Update-CopilotComment: Skipping update of thread #${threadId} — required environment variable(s) not set: ${missing.join(', ')}`);
        return;
    }

    const client = new AdoClient({ collectionUri, project, token, authType });
    const status = args['status'] ?? 'Fixed';
    const commentId = parseInt(args['commentId'] ?? '0', 10);
    const content = args['content'];

    // Update thread status
    await updateThreadStatus(client, repository, parseInt(prId, 10), threadId, status);

    // Update comment content if provided
    if (content && commentId > 0) {
        await updateCommentContent(client, repository, parseInt(prId, 10), threadId, commentId, content);
    }
}

// Always exit 0 — matching Update-CopilotComment.ps1 silent failure behaviour
main().catch((err) => {
    console.warn(`Update-CopilotComment: ${err instanceof Error ? err.message : String(err)}`);
}).finally(() => {
    process.exit(0);
});
