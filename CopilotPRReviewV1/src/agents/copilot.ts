import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Runs the GitHub Copilot CLI by spawning a platform shell (pwsh / bash)
 * that reads the prompt from file and invokes `copilot`.
 *
 * We spawn `pwsh` (PowerShell 7+) on Windows — NOT `powershell` (5.1) —
 * because PS 5.1 has a known bug with native command argument passing:
 * embedded double quotes in a variable are not properly escaped when
 * constructing the command line for external executables. PS 7.3+
 * defaults to the 'Standard' argument passing mode which fixes this.
 *
 * The script is written to a temp file and executed via `-File` to avoid
 * command-line length limits and `-Command` parsing quirks.
 *
 * On Linux we use bash, which handles variable expansion correctly.
 */
export async function runCopilotCli(
    promptFilePath: string,
    model: string | undefined,
    workingDirectory: string,
    timeoutMs: number
): Promise<void> {
    const isWindows = process.platform === 'win32';

    let shellCmd: string;
    let shellArgs: string[];

    if (isWindows) {
        // Build a temp .ps1 script — avoids -Command parsing issues
        const escapedPath = promptFilePath.replace(/'/g, "''");

        const lines: string[] = [
            // Refresh PATH from Windows registry so newly-installed binaries are found
            `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`,
            '',
            '# Log copilot version for debugging',
            'copilot --version',
            '',
            `$prompt = Get-Content -Path '${escapedPath}' -Raw`,
            `Write-Host '========== START PROMPT =========='`,
            `Write-Host $prompt`,
            `Write-Host '========== END PROMPT =========='`,
            '',
            '# Build args as an array so splatting passes each element as a separate argument',
            `$copilotArgs = @('-p', $prompt, '--allow-all-paths', '--allow-all-tools', '--deny-tool', 'shell(git push)')`,
        ];

        if (model) {
            lines.push(`$copilotArgs += @('--model', '${model.replace(/'/g, "''")}')`);
        }

        lines.push(
            '',
            '& copilot @copilotArgs',
            'exit $LASTEXITCODE',
        );

        const scriptContent = lines.join('\n');
        const scriptPath = path.join(workingDirectory, '_copilot_run.ps1');
        fs.writeFileSync(scriptPath, scriptContent, 'utf8');

        shellCmd = 'pwsh';
        shellArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    } else {
        // bash — variable expansion inside double quotes is safe
        const escapedPath = promptFilePath.replace(/'/g, "'\\''");

        const parts: string[] = [
            // Ensure ~/.local/bin is on PATH (where Copilot CLI installs on Linux)
            `export PATH="$HOME/.local/bin:$PATH"`,
            // Log version for debugging
            `copilot --version`,
            `prompt=$(cat '${escapedPath}')`,
            `echo '========== START PROMPT =========='`,
            `echo "$prompt"`,
            `echo '========== END PROMPT =========='`,
        ];

        // Build copilot command with properly quoted args
        let copilotCmd = `copilot -p "$prompt" --allow-all-paths --allow-all-tools --deny-tool 'shell(git push)'`;
        if (model) {
            copilotCmd += ` --model '${model.replace(/'/g, "'\\''")}'`;
        }
        parts.push(copilotCmd);

        const bashScript = parts.join('; ');
        shellCmd = 'bash';
        shellArgs = ['-c', bashScript];
    }

    console.log(`Running Copilot CLI with prompt from: ${promptFilePath}`);
    console.log(`Platform: ${isWindows ? 'Windows (pwsh)' : 'Linux (bash)'}`);

    return new Promise((resolve, reject) => {
        const proc = child_process.spawn(shellCmd, shellArgs, {
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
