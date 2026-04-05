#!/usr/bin/env node
/**
 * Standalone CLI script called by the AI agent to post PR comments.
 *
 * Usage:
 *   node add-comment.js --comment "text" --status Active \
 *     [--file-path /src/Foo.cs --start-line 42 --end-line 45]
 */

import { AdoClient } from '../ado-api/client';
import { createComment } from '../ado-api/comments';
import { parseArgs, loadAdoEnv } from '../utils/args';

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (!args['comment']) {
        console.error('Error: --comment is required');
        process.exit(1);
    }

    const env = loadAdoEnv('add-comment');
    if (!env) process.exit(1);

    const status = (args['status'] ?? 'Active') as 'Active' | 'Fixed' | 'WontFix' | 'Closed' | 'Pending';
    const startLine = args['startLine'] ? parseInt(args['startLine'], 10) : undefined;
    const endLine = args['endLine'] ? parseInt(args['endLine'], 10) : undefined;
    const iterationId = process.env['ITERATION_ID'] ? parseInt(process.env['ITERATION_ID'], 10) : undefined;

    const client = new AdoClient({ collectionUri: env.collectionUri, project: env.project, token: env.token, authType: env.authType });

    const result = await createComment(client, env.repository, parseInt(env.prId, 10), {
        comment: args['comment'],
        status,
        filePath: args['filePath'],
        startLine,
        endLine,
        iterationId,
    });

    console.log(`Comment posted (thread #${result.threadId}, status: ${status}).`);
}

main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
