import * as child_process from 'child_process';
import * as fs from 'fs';

/**
 * Refreshes the Node process's PATH so that binaries installed during the
 * current pipeline run (e.g. via winget) are discoverable.
 *
 *  - Windows: reads the current Machine + User PATH from the registry
 *    (winget updates the registry but not the running process).
 *  - Linux: prepends ~/.local/bin (where the Copilot install script puts it).
 */
function refreshPath(): void {
    if (process.platform === 'win32') {
        try {
            const newPath = child_process.execSync(
                'powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'Path\',\'Machine\') + \';\' + [System.Environment]::GetEnvironmentVariable(\'Path\',\'User\')"',
                { encoding: 'utf8' },
            ).trim();
            process.env['PATH'] = newPath;
        } catch (err) {
            console.log(`  Warning: Could not refresh PATH: ${err instanceof Error ? err.message : String(err)}`);
        }
    } else {
        const home = process.env['HOME'] ?? '';
        const localBin = `${home}/.local/bin`;
        if (!process.env['PATH']?.includes(localBin)) {
            process.env['PATH'] = `${localBin}:${process.env['PATH']}`;
        }
    }
}

/**
 * Runs the GitHub Copilot CLI.
 *
 * The prompt is read in Node and passed as a direct OS-level argument via
 * child_process.spawn with shell: false.  This avoids all shell quoting /
 * metacharacter issues (cmd.exe and PowerShell both corrupt arguments
 * containing double quotes).  Works because winget installs copilot as a
 * native executable, not a .cmd shim.
 */
export async function runCopilotCli(
    promptFilePath: string,
    model: string | undefined,
    workingDirectory: string,
    timeoutMs: number,
): Promise<void> {
    refreshPath();

    // Read prompt in Node — no shell involved
    const promptContent = fs.readFileSync(promptFilePath, 'utf8');

    // Each element becomes one OS-level argument — no shell interpretation
    const args = [
        '-p', promptContent,
        '--allow-all-paths',
        '--allow-all-tools',
        '--deny-tool', 'shell(git push)',
    ];
    if (model) {
        args.push('--model', model);
    }

    return new Promise((resolve, reject) => {
        const proc = child_process.spawn('copilot', args, {
            shell: false,
            stdio: 'inherit',
            cwd: workingDirectory,
            env: { ...process.env },
        });

        const timeoutId = setTimeout(() => {
            console.log(`\n  Timeout reached (${timeoutMs / 60000} min). Terminating...`);
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
