#!/usr/bin/env node
/**
 * Standalone CLI script called by the AI agent to delete PR comments.
 * Replaces Delete-CopilotComment.ps1.
 * Fails silently — always exits 0.
 *
 * Usage:
 *   node delete-comment.js --thread-id 123 --comment-id 456
 *
 * Environment variables: AZUREDEVOPS_TOKEN, AZUREDEVOPS_AUTH_TYPE,
 *   AZUREDEVOPS_COLLECTION_URI, PROJECT, REPOSITORY, PRID
 */

import { AdoClient } from '../ado-api/client';
import { deleteComment } from '../ado-api/comments';

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
    const commentId = parseInt(args['commentId'] ?? '0', 10);

    if (!threadId || !commentId) {
        console.warn('Delete-CopilotComment: --thread-id and --comment-id are required');
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
        console.warn(`Delete-CopilotComment: Skipping deletion of comment #${commentId} in thread #${threadId} — required environment variable(s) not set: ${missing.join(', ')}`);
        return;
    }

    const client = new AdoClient({ collectionUri, project, token, authType });
    await deleteComment(client, repository, parseInt(prId, 10), threadId, commentId);
}

// Always exit 0 — matching Delete-CopilotComment.ps1 silent failure behaviour
main().catch((err) => {
    console.warn(`Delete-CopilotComment: ${err instanceof Error ? err.message : String(err)}`);
}).finally(() => {
    process.exit(0);
});
