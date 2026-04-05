#!/usr/bin/env node
/**
 * Standalone CLI script called by the AI agent to delete PR comments.
 * Fails silently — always exits 0.
 *
 * Usage:
 *   node delete-comment.js --thread-id 123 --comment-id 456
 */

import { AdoClient } from '../ado-api/client';
import { deleteComment } from '../ado-api/comments';
import { parseArgs, loadAdoEnv } from '../utils/args';

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const threadId = parseInt(args['threadId'] ?? '0', 10);
    const commentId = parseInt(args['commentId'] ?? '0', 10);

    if (!threadId || !commentId) {
        console.warn('delete-comment: --thread-id and --comment-id are required');
        return;
    }

    const env = loadAdoEnv('delete-comment');
    if (!env) return;

    const client = new AdoClient({ collectionUri: env.collectionUri, project: env.project, token: env.token, authType: env.authType });
    await deleteComment(client, env.repository, parseInt(env.prId, 10), threadId, commentId);
}

// Always exit 0 — silent failure behaviour
main().catch((err) => {
    console.warn(`delete-comment: ${err instanceof Error ? err.message : String(err)}`);
}).finally(() => {
    process.exit(0);
});
