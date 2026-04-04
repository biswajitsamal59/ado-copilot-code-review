import * as fs from 'fs';
import * as path from 'path';
import { AdoClient } from '../ado-api/client';
import {
    fetchPrDetails,
    fetchPrWorkItemIds,
    fetchPrIterations,
    fetchPrThreads,
    fetchPrCommits,
    filterCopilotThreads,
    formatPrDetailsText,
} from '../ado-api/pull-requests';
import { fetchWorkItems, formatWorkItemsText } from '../ado-api/work-items';
import {
    ChangeEntry,
    fetchIterationChanges,
    fetchIterationDiffs,
    chunkDiffs,
    formatIterationDetailsText,
} from './diff-fetcher';

export interface PrContextOptions {
    includeWorkItems: boolean;
}

export interface ReviewChunk {
    chunkIndex: number;
    totalChunks: number;
    iterationDetailsPath: string;
    fileCount: number;
}

export interface PrContextResult {
    iterationId: number;
    prDetailsPath: string;
    chunks: ReviewChunk[];
    workItemDetailsPath: string | null;
    workItemIdsPath: string;
    iterationIdPath: string;
}

/**
 * Builds all PR context files in the output directory.
 * Diffs are split into chunks so each agent run stays within the context budget.
 */
export async function buildPrContext(
    client: AdoClient,
    repo: string,
    prId: number,
    outputDir: string,
    options: PrContextOptions
): Promise<PrContextResult> {
    console.log('\n[Step 2/5] Fetching pull request details...');
    const [prDetails, workItemIds, iterations, threads] = await Promise.all([
        fetchPrDetails(client, repo, prId),
        fetchPrWorkItemIds(client, repo, prId),
        fetchPrIterations(client, repo, prId),
        fetchPrThreads(client, repo, prId),
    ]);

    const collectionUri = client.getCollectionUri();
    const copilotThreads = filterCopilotThreads(threads);

    const prDetailsText = formatPrDetailsText(
        prDetails,
        threads,
        iterations,
        workItemIds,
        copilotThreads,
        collectionUri
    );

    const prDetailsPath = path.join(outputDir, 'PR_Details.txt');
    fs.writeFileSync(prDetailsPath, prDetailsText, 'utf8');
    console.log(`PR details saved to: ${prDetailsPath}`);

    // Write work item IDs file
    const workItemIdsPath = path.join(outputDir, 'Work_Item_Ids.txt');
    if (workItemIds.length > 0) {
        fs.writeFileSync(workItemIdsPath, workItemIds.join(','), 'utf8');
        console.log(`Work item IDs written to: ${workItemIdsPath}`);
    }

    // ── Iteration Details ────────────────────────────────────────────────────
    console.log('\n[Step 3/5] Fetching pull request changes...');

    if (iterations.length === 0) {
        throw new Error(`No iterations found for pull request #${prId}`);
    }

    // Use the latest iteration
    const latestIteration = iterations.reduce((a, b) => (a.id > b.id ? a : b));
    const iterationId = latestIteration.id;

    const [commits, changeEntries] = await Promise.all([
        fetchPrCommits(client, repo, prId),
        fetchIterationChanges(client, repo, prId, iterationId),
    ]);

    console.log(`Fetching diffs for ${changeEntries.length} changed file(s)...`);
    const allDiffs = await fetchIterationDiffs(
        client,
        repo,
        prId,
        iterationId,
        changeEntries,
        latestIteration.sourceRefCommit?.commitId ?? '',
        latestIteration.targetRefCommit?.commitId ?? ''
    );

    // Split diffs into chunks that fit the context budget
    const diffChunks = chunkDiffs(allDiffs);
    console.log(`Split ${allDiffs.length} file(s) into ${diffChunks.length} review chunk(s).`);

    const chunks: ReviewChunk[] = [];

    for (let i = 0; i < diffChunks.length; i++) {
        const chunkDiffs = diffChunks[i];

        // Build the change entries subset matching this chunk's files
        const chunkPaths = new Set(chunkDiffs.map(d => d.path));
        const chunkChangeEntries = changeEntries.filter(c => chunkPaths.has(c.item.path));

        const iterationDetailsText = formatIterationDetailsText(
            iterationId,
            latestIteration,
            commits,
            chunkChangeEntries,
            chunkDiffs,
            collectionUri,
            client.getProject(),
            repo,
            prId,
            diffChunks.length > 1 ? { chunkIndex: i + 1, totalChunks: diffChunks.length, totalFiles: allDiffs.length } : undefined
        );

        // Single chunk: Iteration_Details.txt, multiple: Iteration_Details_Chunk1.txt etc.
        const fileName = diffChunks.length === 1
            ? 'Iteration_Details.txt'
            : `Iteration_Details_Chunk${i + 1}.txt`;
        const iterationDetailsPath = path.join(outputDir, fileName);
        fs.writeFileSync(iterationDetailsPath, iterationDetailsText, 'utf8');
        console.log(`  Chunk ${i + 1}/${diffChunks.length}: ${chunkDiffs.length} file(s) → ${fileName}`);

        chunks.push({
            chunkIndex: i,
            totalChunks: diffChunks.length,
            iterationDetailsPath,
            fileCount: chunkDiffs.length,
        });
    }

    const iterationIdPath = path.join(outputDir, 'Iteration_Id.txt');
    fs.writeFileSync(iterationIdPath, String(iterationId), 'utf8');
    console.log(`Iteration ID (${iterationId}) written to: ${iterationIdPath}`);

    // ── Work Item Details (optional) ─────────────────────────────────────────
    let workItemDetailsPath: string | null = null;

    if (options.includeWorkItems) {
        console.log('\n[Step 4/5] Fetching linked work item details...');
        if (workItemIds.length > 0) {
            try {
                const workItemDetails = await fetchWorkItems(client, workItemIds);
                const workItemDetailsText = formatWorkItemsText(workItemDetails);
                workItemDetailsPath = path.join(outputDir, 'Work_Item_Details.txt');
                fs.writeFileSync(workItemDetailsPath, workItemDetailsText, 'utf8');
                console.log(`Work item details saved to: ${workItemDetailsPath}`);
            } catch (err) {
                console.log('Warning: Failed to fetch work item details. Continuing without work item context.');
                console.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
            }
        } else {
            console.log('No linked work items for this PR. Skipping work item detail fetch.');
        }
    } else {
        console.log('\n[Step 4/5] Skipping work item details (disabled).');
    }

    return {
        iterationId,
        prDetailsPath,
        chunks,
        workItemDetailsPath,
        workItemIdsPath,
        iterationIdPath,
    };
}
