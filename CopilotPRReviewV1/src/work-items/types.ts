export interface WorkItemDetails {
    id: string;        // string to support JIRA keys like "PSDO-3897"
    type: string;
    title: string;
    state: string;
    description: string;
    acceptanceCriteria: string;
    reproSteps: string;
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
        lines.push(`[${wi.id} - ${wi.type}]`);
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
