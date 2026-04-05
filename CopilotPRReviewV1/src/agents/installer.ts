import * as child_process from 'child_process';
import * as path from 'path';

function isWindows(): boolean {
    return process.platform === 'win32';
}

function spawnSync(cmd: string, args: string[]): boolean {
    try {
        const result = child_process.spawnSync(cmd, args, { encoding: 'utf8', shell: true });
        return result.status === 0;
    } catch {
        return false;
    }
}

/**
 * Returns true if a line is progress-bar noise from winget or curl.
 * Matches: block chars (█▒░), spinners (- \ | /), and whitespace-only lines.
 */
function isNoiseLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/[█▒░]/.test(trimmed)) return true;
    if (/^[\\|/\-]\s*$/.test(trimmed)) return true;
    return false;
}

// ─── Copilot CLI ──────────────────────────────────────────────────────────────

export async function checkCopilotCli(): Promise<boolean> {
    return spawnSync('copilot', ['--version']);
}

export async function installCopilotCli(): Promise<void> {
    return new Promise((resolve, reject) => {
        let command: string;
        let args: string[];

        if (isWindows()) {
            command = 'winget';
            args = [
                'install', 'GitHub.Copilot',
                '--silent',
                '--accept-package-agreements',
                '--accept-source-agreements',
                '--disable-interactivity',
            ];
        } else {
            command = 'curl -fsSL https://gh.io/copilot-install | bash';
            args = [];
        }

        // Pipe output so we can filter progress-bar noise
        const proc = child_process.spawn(command, args, { shell: true, stdio: 'pipe' });

        const forwardOutput = (data: Buffer) => {
            for (const line of data.toString().split(/\r?\n/)) {
                if (!isNoiseLine(line)) {
                    console.log(`  ${line.trim()}`);
                }
            }
        };

        proc.stdout?.on('data', forwardOutput);
        proc.stderr?.on('data', forwardOutput);

        proc.on('close', (code) => {
            if (code === 0) {
                if (!isWindows()) {
                    const localBin = path.join(process.env['HOME'] ?? '', '.local', 'bin');
                    process.env['PATH'] = `${localBin}:${process.env['PATH']}`;
                }
                resolve();
            } else {
                reject(new Error(`Failed to install GitHub Copilot CLI (exit code: ${code})`));
            }
        });

        proc.on('error', (err) => reject(new Error(`Failed to install GitHub Copilot CLI: ${err.message}`)));
    });
}
