import * as child_process from 'child_process';
import * as fs from 'fs';

/**
 * Runs the GitHub Copilot CLI directly (no PowerShell wrapper).
 * Reads the prompt file content in TypeScript and passes it via the -p argument.
 */
export async function runCopilotCli(
    promptFilePath: string,
    model: string | undefined,
    workingDirectory: string,
    timeoutMs: number
): Promise<void> {
    const prompt = fs.readFileSync(promptFilePath, 'utf8');

    const args = [
        '-p', prompt,
        '--allow-all-paths',
        '--allow-all-tools',
        '--deny-tool', 'shell(git push)',
    ];

    if (model) {
        args.push('--model', model);
    }

    console.log(`Running Copilot CLI with prompt from: ${promptFilePath}`);
    console.log('========== START PROMPT ==========');
    console.log(prompt);
    console.log('========== END PROMPT ==========');

    return new Promise((resolve, reject) => {
        const proc = child_process.spawn('copilot', args, {
            shell: false,
            stdio: 'inherit',
            cwd: workingDirectory,
            env: { ...process.env },
        });

        const timeoutId = setTimeout(() => {
            console.log(`\nTimeout reached (${timeoutMs / 60000} minutes). Terminating Copilot process...`);
            proc.kill('SIGTERM');
            reject(new Error(`Copilot review timed out after ${timeoutMs / 60000} minutes`));
        }, timeoutMs);

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Copilot CLI exited with code: ${code}`));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(new Error(`Failed to run Copilot CLI: ${err.message}`));
        });
    });
}
