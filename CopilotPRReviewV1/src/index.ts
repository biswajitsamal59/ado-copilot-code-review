import * as tl from 'azure-pipelines-task-lib/task';
import * as path from 'path';
import * as fs from 'fs';
import { AdoClient } from './ado-api/client';
import { buildPrContext } from './context/pr-context';
import { resolvePrompt } from './utils/prompt';
import { checkCopilotCli, installCopilotCli } from './agents/installer';
import { runCopilotCli } from './agents/copilot';

async function run(): Promise<void> {
    try {
        // ── Input validation ──────────────────────────────────────────────────

        // Author filter (check before anything else)
        const authors = tl.getInput('authors');
        if (authors) {
            const requestedForEmail = tl.getVariable('Build.RequestedForEmail') ?? '';
            const authorList = authors.split(',').map(e => e.trim().toLowerCase());
            const currentAuthor = requestedForEmail.toLowerCase();

            console.log('='.repeat(60));
            console.log('Author Filter Check');
            console.log('='.repeat(60));
            console.log(`Configured authors: ${authorList.join(', ')}`);
            console.log(`PR author email: ${requestedForEmail || '(not available)'}`);

            if (!authorList.includes(currentAuthor)) {
                console.log('Result: PR author is NOT in the configured authors list.');
                console.log('Skipping code review for this PR.');
                console.log('='.repeat(60));
                tl.setResult(tl.TaskResult.Succeeded, 'Skipped: PR author not in configured authors list.');
                return;
            }

            console.log('Result: PR author IS in the configured authors list.');
            console.log('Proceeding with code review.');
            console.log('='.repeat(60));
        }

        const githubPat = tl.getInput('githubPat');
        if (!githubPat) {
            tl.setResult(tl.TaskResult.Failed,
                'GitHub PAT is required for GitHub Copilot CLI. Please provide the githubPat input.');
            return;
        }

        // Azure DevOps authentication
        const useSystemAccessToken = tl.getBoolInput('useSystemAccessToken', false);
        const azureDevOpsPat = tl.getInput('azureDevOpsPat');

        let azureDevOpsToken: string;
        let azureDevOpsAuthType: 'Bearer' | 'Basic';

        if (useSystemAccessToken) {
            const systemToken = tl.getVariable('System.AccessToken');
            if (!systemToken) {
                tl.setResult(tl.TaskResult.Failed,
                    'System.AccessToken is not available. Ensure the pipeline has access to the OAuth token.');
                return;
            }
            azureDevOpsToken = systemToken;
            azureDevOpsAuthType = 'Bearer';
            console.log('Using System.AccessToken (OAuth) for Azure DevOps authentication.');
        } else if (azureDevOpsPat) {
            azureDevOpsToken = azureDevOpsPat;
            azureDevOpsAuthType = 'Basic';
            console.log('Using Personal Access Token for Azure DevOps authentication.');
        } else {
            tl.setResult(tl.TaskResult.Failed,
                'Azure DevOps authentication is required. Either provide an Azure DevOps PAT or enable "Use System Access Token".');
            return;
        }

        // Collection URI resolution
        const collectionUriInput = tl.getInput('collectionUri');
        const organizationInput = tl.getInput('organization');
        let resolvedCollectionUri: string | undefined;

        if (collectionUriInput) {
            resolvedCollectionUri = collectionUriInput.replace(/\/+$/, '');
            console.log(`Using explicit collection URI: ${resolvedCollectionUri}`);
        } else if (organizationInput) {
            resolvedCollectionUri = `https://dev.azure.com/${organizationInput}`;
            console.log(`Constructed collection URI from organization: ${resolvedCollectionUri}`);
        } else {
            const systemCollectionUri = tl.getVariable('System.CollectionUri');
            if (systemCollectionUri) {
                resolvedCollectionUri = systemCollectionUri.replace(/\/+$/, '');
                console.log(`Auto-detected collection URI from System.CollectionUri: ${resolvedCollectionUri}`);
            }
        }

        if (!resolvedCollectionUri) {
            tl.setResult(tl.TaskResult.Failed,
                'Collection URI could not be determined. Provide collectionUri, organization, or ensure System.CollectionUri is available.');
            return;
        }

        const project = tl.getInput('project');
        if (!project) {
            tl.setResult(tl.TaskResult.Failed, 'Project is required.');
            return;
        }

        const repository = tl.getInput('repository');
        if (!repository) {
            tl.setResult(tl.TaskResult.Failed, 'Repository is required.');
            return;
        }

        let pullRequestId = tl.getInput('pullRequestId');
        if (!pullRequestId) {
            pullRequestId = tl.getVariable('System.PullRequest.PullRequestId');
        }
        if (!pullRequestId) {
            tl.setResult(tl.TaskResult.Failed,
                'Pull Request ID is required. Either provide it as an input or run as part of a PR validation build.');
            return;
        }

        const timeoutMinutes = parseInt(tl.getInput('timeout') ?? '15', 10);
        const model = tl.getInput('model');
        const includeWorkItems = tl.getBoolInput('includeWorkItems', false);

        console.log('='.repeat(60));
        console.log('Copilot PR Review Task');
        console.log('='.repeat(60));
        console.log(`Collection URI:  ${resolvedCollectionUri}`);
        console.log(`Project:         ${project}`);
        console.log(`Repository:      ${repository}`);
        console.log(`Pull Request ID: ${pullRequestId}`);
        console.log(`Timeout:         ${timeoutMinutes} minutes`);
        if (model) console.log(`Model:           ${model}`);
        console.log('='.repeat(60));

        // ── Set environment variables for agent scripts ────────────────────────
        process.env['GH_TOKEN'] = githubPat;
        process.env['AZUREDEVOPS_TOKEN'] = azureDevOpsToken;
        process.env['AZUREDEVOPS_AUTH_TYPE'] = azureDevOpsAuthType;
        process.env['AZUREDEVOPS_COLLECTION_URI'] = resolvedCollectionUri;
        process.env['PROJECT'] = project;
        process.env['REPOSITORY'] = repository;
        process.env['PRID'] = pullRequestId;

        const workingDirectory = tl.getVariable('System.DefaultWorkingDirectory') ?? process.cwd();
        const scriptsDir = path.join(__dirname, 'scripts');

        // ── Step 1: Install GitHub Copilot CLI ────────────────────────────────
        console.log('\n[Step 1/5] Checking GitHub Copilot CLI installation...');
        if (!await checkCopilotCli()) {
            console.log('GitHub Copilot CLI not found. Installing...');
            await installCopilotCli();
        } else {
            console.log('GitHub Copilot CLI is already installed.');
        }

        // ── Steps 2-4: Build PR context (replaces 3 PS script invocations) ────
        const client = new AdoClient({
            collectionUri: resolvedCollectionUri,
            project,
            token: azureDevOpsToken,
            authType: azureDevOpsAuthType,
        });

        const context = await buildPrContext(client, repository, parseInt(pullRequestId, 10), workingDirectory, {
            includeWorkItems,
        });

        // Expose iteration ID to agent scripts via environment
        process.env['ITERATION_ID'] = String(context.iterationId);
        console.log(`Iteration ID set to: ${context.iterationId}`);

        // ── Step 5: Run Copilot code review ───────────────────────────────────

        const promptFilePath = resolvePrompt({
            promptInput: tl.getInput('prompt') || undefined,
            promptFileInput: tl.getInput('promptFile') || undefined,
            promptRawInput: tl.getInput('promptRaw') || undefined,
            promptFileRawInput: tl.getInput('promptFileRaw') || undefined,
            scriptsDir,
            workingDir: workingDirectory,
        });

        // Write thin wrapper scripts so the AI agent can call node ./add-comment.js
        writeAgentScriptWrappers(workingDirectory, scriptsDir);

        const timeoutMs = timeoutMinutes * 60 * 1000;
        const { chunks } = context;

        if (chunks.length === 1) {
            // Single chunk — standard review
            console.log('\n[Step 5/5] Running Copilot code review...');

            // Write Iteration_Details.txt as the standard name the prompt references
            copyIfNeeded(chunks[0].iterationDetailsPath, path.join(workingDirectory, 'Iteration_Details.txt'));

            await runCopilotCli(promptFilePath, model || undefined, workingDirectory, timeoutMs);
        } else {
            // Multiple chunks — run one agent per chunk
            console.log(`\n[Step 5/5] Running chunked Copilot code review (${chunks.length} chunks)...`);
            const perChunkTimeout = Math.max(timeoutMs / chunks.length, 5 * 60 * 1000); // min 5 min per chunk

            for (const chunk of chunks) {
                const chunkNum = chunk.chunkIndex + 1;
                console.log(`\n${'─'.repeat(60)}`);
                console.log(`Chunk ${chunkNum}/${chunk.totalChunks}: Reviewing ${chunk.fileCount} file(s)...`);
                console.log('─'.repeat(60));

                // Overwrite Iteration_Details.txt with this chunk's content
                // so the prompt's reference to "Iteration_Details.txt" always works
                const iterationDetailsTarget = path.join(workingDirectory, 'Iteration_Details.txt');
                fs.copyFileSync(chunk.iterationDetailsPath, iterationDetailsTarget);

                // First chunk uses the original prompt (handles thread resolution + review).
                // Subsequent chunks use a continuation prompt (review only, skip thread resolution).
                const chunkPromptPath = chunkNum === 1
                    ? promptFilePath
                    : buildChunkContinuationPrompt(promptFilePath, chunkNum, chunk.totalChunks, workingDirectory);

                try {
                    await runCopilotCli(chunkPromptPath, model || undefined, workingDirectory, perChunkTimeout);
                    console.log(`Chunk ${chunkNum}/${chunk.totalChunks} completed.`);
                } catch (err) {
                    // Log chunk failure but continue with remaining chunks
                    console.log(`Warning: Chunk ${chunkNum}/${chunk.totalChunks} failed: ${err instanceof Error ? err.message : String(err)}`);
                    console.log('Continuing with remaining chunks...');
                }
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('Copilot Code Review completed successfully!');
        console.log('='.repeat(60));

        tl.setResult(tl.TaskResult.Succeeded, 'Copilot code review completed.');
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        tl.setResult(tl.TaskResult.Failed, `Task failed: ${errorMessage}`);
    }
}

/**
 * Writes thin 1-line Node.js wrapper scripts to the working directory.
 * The AI agent calls `node ./add-comment.js` without needing to know the
 * absolute path of the compiled task modules in the extension directory.
 */
function writeAgentScriptWrappers(workingDirectory: string, scriptsDir: string): void {
    const scripts: Array<{ wrapper: string; compiled: string }> = [
        { wrapper: 'add-comment.js', compiled: path.join(scriptsDir, 'add-comment.js') },
        { wrapper: 'update-comment.js', compiled: path.join(scriptsDir, 'update-comment.js') },
        { wrapper: 'delete-comment.js', compiled: path.join(scriptsDir, 'delete-comment.js') },
    ];

    for (const { wrapper, compiled } of scripts) {
        const content = `require(${JSON.stringify(compiled)});\n`;
        const destPath = path.join(workingDirectory, wrapper);
        fs.writeFileSync(destPath, content, 'utf8');
        console.log(`Wrote agent script wrapper: ${destPath}`);
    }
}

/**
 * Copies a file to a destination if they are different paths.
 */
function copyIfNeeded(src: string, dest: string): void {
    if (path.resolve(src) !== path.resolve(dest)) {
        fs.copyFileSync(src, dest);
    }
}

/**
 * Builds a continuation prompt for chunk 2+ that skips thread resolution
 * and focuses only on reviewing the files in the current chunk.
 */
function buildChunkContinuationPrompt(
    originalPromptPath: string,
    chunkNum: number,
    totalChunks: number,
    workingDir: string
): string {
    const originalPrompt = fs.readFileSync(originalPromptPath, 'utf8');

    // Replace the thread resolution section with a skip instruction
    const continuationNote = `
# Chunked Review Note

This is chunk ${chunkNum} of ${totalChunks} in a chunked code review. The PR has too many changed files to review in a single pass, so it has been split into multiple review runs.

**IMPORTANT for this chunk:**
- Skip the "Updating Feedback State" section — thread resolution was already handled in chunk 1.
- Focus ONLY on the files listed in the Iteration_Details.txt file for this chunk.
- Do NOT duplicate feedback that may have been posted by earlier chunks.
- You may still use git and file-reading tools to gather context about files outside this chunk.
`;

    const chunkPrompt = continuationNote + '\n' + originalPrompt;
    const outPath = path.join(workingDir, `_copilot_prompt_chunk${chunkNum}.txt`);
    fs.writeFileSync(outPath, chunkPrompt, 'utf8');
    return outPath;
}

run();
