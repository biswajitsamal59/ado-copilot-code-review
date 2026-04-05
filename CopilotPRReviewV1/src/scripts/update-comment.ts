#!/usr/bin/env node
/**
 * Standalone CLI script called by the AI agent to update PR comment threads.
 * Fails silently — always exits 0.
 *
 * Usage:
 *   node update-comment.js --thread-id 123 --status Fixed
 *   node update-comment.js --thread-id 123 --comment-id 456 --content "Updated text"
 */

import { AdoClient } from '../ado-api/client';
import { updateThreadStatus, updateCommentContent } from '../ado-api/comments';
import { parseArgs, loadAdoEnv } from '../utils/args';

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const threadId = parseInt(args['threadId'] ?? '0', 10);

    if (!threadId) {
        console.warn('update-comment: --thread-id is required');
        return;
    }

    const env = loadAdoEnv('update-comment');
    if (!env) return;

    const client = new AdoClient({ collectionUri: env.collectionUri, project: env.project, token: env.token, authType: env.authType });
    const prIdNum = parseInt(env.prId, 10);

    await updateThreadStatus(client, env.repository, prIdNum, threadId, args['status'] ?? 'Fixed');

    const commentId = parseInt(args['commentId'] ?? '0', 10);
    if (args['content'] && commentId > 0) {
        await updateCommentContent(client, env.repository, prIdNum, threadId, commentId, args['content']);
    }
}

// Always exit 0 — silent failure behaviour
main().catch((err) => {
    console.warn(`update-comment: ${err instanceof Error ? err.message : String(err)}`);
}).finally(() => {
    process.exit(0);
});
