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
    fetchIterationChanges,
    fetchIterationDiffs,
    formatIterationDetailsText,
} from './diff-fetcher';

export interface PrContextOptions {
    includeWorkItems: boolean;
}

export interface PrContextResult {
    iterationId: number;
    prDetailsPath: string;
    iterationDetailsPath: string;
    workItemDetailsPath: string | null;
    workItemIdsPath: string;
    iterationIdPath: string;
}

/**
 * Builds all PR context files in the output directory.
 * Replaces the three separate PowerShell script invocations in index.ts:
 *   - Get-AzureDevOpsPR.ps1       → PR_Details.txt + Work_Item_Ids.txt
 *   - Get-AzureDevOpsPRChanges.ps1 → Iteration_Details.txt + Iteration_Id.txt
 *   - Get-AzureDevOpsWorkItems.ps1 → Work_Item_Details.txt
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
    const diffs = await fetchIterationDiffs(
        client,
        repo,
        prId,
        iterationId,
        changeEntries,
        latestIteration.sourceRefCommit?.commitId ?? '',
        latestIteration.targetRefCommit?.commitId ?? ''
    );

    const iterationDetailsText = formatIterationDetailsText(
        iterationId,
        latestIteration,
        commits,
        changeEntries,
        diffs,
        collectionUri,
        client.getProject(),
        repo,
        prId
    );

    const iterationDetailsPath = path.join(outputDir, 'Iteration_Details.txt');
    fs.writeFileSync(iterationDetailsPath, iterationDetailsText, 'utf8');
    console.log(`Iteration details saved to: ${iterationDetailsPath}`);

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
        iterationDetailsPath,
        workItemDetailsPath,
        workItemIdsPath,
        iterationIdPath,
    };
}
