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
 * All paths produce a single prompt from `scripts/prompt.txt`.
 * - Default: the template with %CUSTOMPROMPT% stripped
 * - Custom (inline or file): user text replaces %CUSTOMPROMPT%
 * - Raw (inline or file): used verbatim, bypassing the template entirely
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

    const outPath = path.join(workingDir, '_copilot_prompt.txt');
    const template = fs.readFileSync(path.join(scriptsDir, 'prompt.txt'), 'utf8');

    if (promptRawInput) {
        // Raw prompt: pass directly, bypass template
        console.log('  Prompt: raw (inline)');
        fs.writeFileSync(outPath, promptRawInput, 'utf8');
    } else if (isPromptFileRawSet) {
        // Raw prompt file: use contents as-is
        console.log('  Prompt: raw (file)');
        const fileContent = fs.readFileSync(promptFileRawInput!, 'utf8');
        if (!fileContent.trim()) {
            tl.setResult(tl.TaskResult.Failed, `Raw prompt file is empty: ${promptFileRawInput}`);
            process.exit(1);
        }
        fs.writeFileSync(outPath, fileContent, 'utf8');
    } else if (promptInput) {
        // Custom inline prompt: inject into template
        console.log('  Prompt: custom (inline)');
        validateNoDoubleQuotes(promptInput);
        fs.writeFileSync(outPath, template.replace('%CUSTOMPROMPT%', promptInput), 'utf8');
    } else if (isPromptFileSet) {
        // Custom prompt from file: inject into template
        console.log('  Prompt: custom (file)');
        const fileContent = fs.readFileSync(promptFileInput!, 'utf8').trim();
        if (!fileContent) {
            tl.setResult(tl.TaskResult.Failed, `Prompt file is empty: ${promptFileInput}`);
            process.exit(1);
        }
        validateNoDoubleQuotes(fileContent, promptFileInput);
        fs.writeFileSync(outPath, template.replace('%CUSTOMPROMPT%', fileContent), 'utf8');
    } else {
        // Default: strip the placeholder
        console.log('  Prompt: default');
        fs.writeFileSync(outPath, template.replace('%CUSTOMPROMPT%', ''), 'utf8');
    }

    return outPath;
}

function validateNoDoubleQuotes(text: string, source?: string): void {
    if (text.includes('"')) {
        const location = source ? `the prompt file: ${source}` : 'your prompt input';
        tl.setResult(
            tl.TaskResult.Failed,
            `Custom prompts cannot include double quotes ("). Please remove any double quotes from ${location}.`
        );
        process.exit(1);
    }
}
