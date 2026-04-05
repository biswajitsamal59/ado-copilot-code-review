import { WorkItemDetails } from './types';

export interface WorkItemProvider {
    extractIds(prDescription: string): string[];
    fetchDetails(ids: string[]): Promise<WorkItemDetails[]>;
}
