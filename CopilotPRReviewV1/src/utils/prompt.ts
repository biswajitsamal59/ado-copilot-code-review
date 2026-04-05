import * as fs from 'fs';
import * as path from 'path';
import * as tl from 'azure-pipelines-task-lib/task';

export interface PromptConfig {
    promptInput: string | undefined;
    promptFileInput: string | undefined;
    promptRawInput: string | undefined;
    promptFileRawInput: string | undefined;
    scriptsDir: string;
    workingDir: string;
}

/**
 * Resolves and validates the prompt inputs, returning the path to the final
 * prompt file to use for the CLI agent.
 *
 * Extracted from index.ts lines 318-412.
 */
export function resolvePrompt(config: PromptConfig): string {
    const {
        promptInput,
        promptFileInput,
        promptRawInput,
        promptFileRawInput,
        scriptsDir,
        workingDir,
    } = config;

    // filePath inputs return the working directory when empty — treat as unset
    const isPromptFileSet = !!(
        promptFileInput &&
        fs.existsSync(promptFileInput) &&
        fs.statSync(promptFileInput).isFile()
    );
    const isPromptFileRawSet = !!(
        promptFileRawInput &&
        fs.existsSync(promptFileRawInput) &&
        fs.statSync(promptFileRawInput).isFile()
    );

    // Validate mutual exclusivity
    const active: string[] = [];
    if (promptInput) active.push('prompt');
    if (isPromptFileSet) active.push('promptFile');
    if (promptRawInput) active.push('promptRaw');
    if (isPromptFileRawSet) active.push('promptFileRaw');

    if (active.length > 1) {
        tl.setResult(
            tl.TaskResult.Failed,
            `Multiple prompt inputs are set (${active.join(', ')}). Only one prompt input should be provided. ` +
            'Please use only one of: prompt, promptFile, promptRaw, or promptFileRaw.'
        );
        process.exit(1);
    }

    let promptFilePath: string;

    if (promptRawInput) {
        // Raw prompt: pass directly with no modification
        console.log('  Prompt: raw (inline)');
        promptFilePath = path.join(workingDir, '_copilot_prompt.txt');
        fs.writeFileSync(promptFilePath, promptRawInput, 'utf8');
    } else if (isPromptFileRawSet) {
        // Raw prompt file: use contents as-is
        console.log('  Prompt: raw (file)');
        const fileContent = fs.readFileSync(promptFileRawInput!, 'utf8');
        if (!fileContent.trim()) {
            tl.setResult(tl.TaskResult.Failed, `Raw prompt file is empty: ${promptFileRawInput}`);
            process.exit(1);
        }
        promptFilePath = path.join(workingDir, '_copilot_prompt.txt');
        fs.writeFileSync(promptFilePath, fileContent, 'utf8');
    } else if (promptInput) {
        // Custom inline prompt: merge with template
        console.log('  Prompt: custom (inline)');
        if (promptInput.includes('"')) {
            tl.setResult(
                tl.TaskResult.Failed,
                'Custom prompts cannot include double quotes ("). Please remove any double quotes from your prompt input.'
            );
            process.exit(1);
        }
        promptFilePath = buildCustomPrompt(promptInput, scriptsDir, workingDir);
    } else if (isPromptFileSet) {
        // Custom prompt from file: merge with template
        console.log('  Prompt: custom (file)');
        const fileContent = fs.readFileSync(promptFileInput!, 'utf8').trim();
        if (!fileContent) {
            tl.setResult(tl.TaskResult.Failed, `Prompt file is empty: ${promptFileInput}`);
            process.exit(1);
        }
        if (fileContent.includes('"')) {
            tl.setResult(
                tl.TaskResult.Failed,
                `Custom prompts cannot include double quotes ("). Please remove any double quotes from the prompt file: ${promptFileInput}`
            );
            process.exit(1);
        }
        promptFilePath = buildCustomPrompt(fileContent, scriptsDir, workingDir);
    } else {
        // Default prompt bundled with the task
        promptFilePath = path.join(scriptsDir, 'prompt.txt');
        console.log('  Prompt: default');
    }

    return promptFilePath;
}

function buildCustomPrompt(customText: string, scriptsDir: string, workingDir: string): string {
    const templatePath = path.join(scriptsDir, 'prompt-custom.txt');
    const template = fs.readFileSync(templatePath, 'utf8');
    const merged = template.replace('%CUSTOMPROMPT%', customText);
    const outPath = path.join(workingDir, '_copilot_prompt.txt');
    fs.writeFileSync(outPath, merged, 'utf8');
    return outPath;
}
