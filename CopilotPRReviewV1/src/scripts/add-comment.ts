#!/usr/bin/env node
/**
 * Standalone CLI script called by the AI agent to post PR comments.
 * Replaces Add-CopilotComment.ps1 + Add-AzureDevOpsPRComment.ps1.
 *
 * Usage:
 *   node add-comment.js --comment "text" --status Active \
 *     [--file-path /src/Foo.cs --start-line 42 --end-line 45]
 *
 * Environment variables:
 *   AZUREDEVOPS_TOKEN, AZUREDEVOPS_AUTH_TYPE,
 *   AZUREDEVOPS_COLLECTION_URI, PROJECT, REPOSITORY, PRID, ITERATION_ID
 */

import { AdoClient } from '../ado-api/client';
import { createComment } from '../ado-api/comments';

function parseArgs(argv: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--') && i + 1 < argv.length) {
            // Convert --file-path → filePath (camelCase)
            const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            result[key] = argv[++i];
        }
    }
    return result;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (!args['comment']) {
        console.error('Error: --comment is required');
        process.exit(1);
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
        console.error(`Error: Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }

    const iterationId = process.env['ITERATION_ID'] ? parseInt(process.env['ITERATION_ID'], 10) : undefined;
    const startLine = args['startLine'] ? parseInt(args['startLine'], 10) : undefined;
    const endLine = args['endLine'] ? parseInt(args['endLine'], 10) : undefined;
    const status = (args['status'] ?? 'Active') as 'Active' | 'Fixed' | 'WontFix' | 'Closed' | 'Pending';

    console.log(`Posting comment with thread status: ${status}`);
    if (args['filePath']) {
        console.log(`Posting inline comment on file: ${args['filePath']} (Lines ${startLine}-${endLine ?? startLine})`);
    }

    const client = new AdoClient({ collectionUri, project, token, authType });

    const result = await createComment(client, repository, parseInt(prId, 10), {
        comment: args['comment'],
        status,
        filePath: args['filePath'],
        startLine,
        endLine,
        iterationId,
    });

    console.log('='.repeat(60));
    console.log('COMMENT THREAD CREATED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log(`  Thread ID:    #${result.threadId}`);
    console.log(`  Comment ID:   #${result.commentId}`);
    console.log(`  Author:       ${result.author}`);
    console.log(`  Posted:       ${result.publishedDate}`);
    console.log('='.repeat(60));
}

main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
