import { AdoClient } from './client';
import { htmlToText } from '../utils/html';

export interface WorkItemDetails {
    id: number;
    type: string;
    title: string;
    state: string;
    description: string;
    acceptanceCriteria: string;
    reproSteps: string;
}

/**
 * Batch-fetches work items by ID. Caps at 200 (ADO API limit).
 * Uses the collection-level work items API (not project-scoped).
 */
export async function fetchWorkItems(
    client: AdoClient,
    workItemIds: number[]
): Promise<WorkItemDetails[]> {
    if (workItemIds.length === 0) return [];

    const ids = workItemIds.slice(0, 200);
    const idsParam = ids.join(',');
    const collectionUri = client.getCollectionUri();
    const project = client.getProject();

    // Work items API is collection-level, not project-scoped
    // URL: {collectionUri}/{project}/_apis/wit/workitems?ids=...&$expand=all
    const url = `${collectionUri}/${project}/_apis/wit/workitems?ids=${idsParam}&%24expand=all&api-version=7.1`;

    const result = await client.get<{ value: Array<Record<string, unknown>> }>(url);
    const items = result.value ?? [];

    return items.map(wi => {
        const fields = (wi.fields ?? {}) as Record<string, string>;
        return {
            id: wi.id as number,
            type: fields['System.WorkItemType'] ?? '',
            title: fields['System.Title'] ?? '',
            state: fields['System.State'] ?? '',
            description: htmlToText(fields['System.Description'] ?? ''),
            acceptanceCriteria: htmlToText(fields['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? ''),
            reproSteps: htmlToText(fields['Microsoft.VSTS.TCM.ReproSteps'] ?? ''),
        };
    });
}

/**
 * Formats work item details into text matching current Work_Item_Details.txt output.
 */
export function formatWorkItemsText(items: WorkItemDetails[]): string {
    const sep80 = '='.repeat(80);
    const lines: string[] = [];

    lines.push(sep80);
    lines.push('LINKED WORK ITEM DETAILS');
    lines.push(sep80);

    for (const wi of items) {
        lines.push('');
        lines.push(`[Work Item #${wi.id} - ${wi.type}]`);
        lines.push(`  Title:           ${wi.title}`);
        lines.push(`  State:           ${wi.state}`);

        if (wi.description.trim()) {
            lines.push('');
            lines.push('  Description:');
            for (const l of wi.description.split('\n')) {
                lines.push(`    ${l}`);
            }
        }

        if (wi.acceptanceCriteria.trim()) {
            lines.push('');
            lines.push('  Acceptance Criteria:');
            for (const l of wi.acceptanceCriteria.split('\n')) {
                lines.push(`    ${l}`);
            }
        }

        if (wi.reproSteps.trim()) {
            lines.push('');
            lines.push('  Repro Steps:');
            for (const l of wi.reproSteps.split('\n')) {
                lines.push(`    ${l}`);
            }
        }
    }

    lines.push('');
    lines.push(sep80);

    return lines.join('\n');
}
