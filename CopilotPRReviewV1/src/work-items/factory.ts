import { WorkItemProvider } from './provider';
import { JiraProvider, JiraConfig } from './jira-provider';

export type WorkItemSource = 'jira' | 'none';

export interface WorkItemProviderConfig {
    source: WorkItemSource;
    jira?: JiraConfig;
}

/**
 * Factory function to create the appropriate work item provider based on configuration.
 * Returns null if no provider is configured or if source is 'none'.
 */
export function createWorkItemProvider(config: WorkItemProviderConfig): WorkItemProvider | null {
    switch (config.source) {
        case 'jira':
            if (!config.jira) return null;
            return new JiraProvider(config.jira);
        default:
            return null;
    }
}
