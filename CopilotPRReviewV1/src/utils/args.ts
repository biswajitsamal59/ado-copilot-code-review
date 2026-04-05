/**
 * Shared CLI argument parser and env var loader for agent scripts
 * (add-comment.js, update-comment.js, delete-comment.js).
 */

/**
 * Parses CLI arguments in --key value format.
 * Converts kebab-case keys to camelCase (e.g. --file-path → filePath).
 */
export function parseArgs(argv: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--') && i + 1 < argv.length) {
            const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            result[key] = argv[++i];
        }
    }
    return result;
}

export interface AdoEnv {
    token: string;
    authType: 'Bearer' | 'Basic';
    collectionUri: string;
    project: string;
    repository: string;
    prId: string;
}

/**
 * Reads ADO environment variables. Returns null if any required var is missing.
 * Logs a warning with the missing variable names using the provided script label.
 */
export function loadAdoEnv(scriptLabel: string): AdoEnv | null {
    const token = process.env['AZUREDEVOPS_TOKEN'];
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
        console.warn(`${scriptLabel}: Missing env vars: ${missing.join(', ')}`);
        return null;
    }

    return {
        token,
        authType: (process.env['AZUREDEVOPS_AUTH_TYPE'] ?? 'Basic') as 'Bearer' | 'Basic',
        collectionUri,
        project,
        repository,
        prId,
    };
}
