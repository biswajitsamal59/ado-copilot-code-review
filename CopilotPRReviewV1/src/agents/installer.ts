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

// ─── Copilot CLI ──────────────────────────────────────────────────────────────

export async function checkCopilotCli(): Promise<boolean> {
    return spawnSync('copilot', ['--version']);
}

export async function installCopilotCli(): Promise<void> {
    return new Promise((resolve, reject) => {
        let command: string;
        let args: string[];

        if (isWindows()) {
            console.log('Installing GitHub Copilot CLI via winget...');
            command = 'winget';
            args = ['install', 'GitHub.Copilot', '--silent', '--accept-package-agreements', '--accept-source-agreements'];
        } else {
            console.log('Installing GitHub Copilot CLI via official install script...');
            command = 'curl -fsSL https://gh.io/copilot-install | bash';
            args = [];
        }

        const proc = child_process.spawn(command, args, { shell: true, stdio: 'inherit' });

        proc.on('close', (code) => {
            if (code === 0) {
                console.log('GitHub Copilot CLI installed successfully.');
                if (!isWindows()) {
                    const localBin = path.join(process.env['HOME'] ?? '', '.local', 'bin');
                    process.env['PATH'] = `${localBin}:${process.env['PATH']}`;
                    console.log(`Added ${localBin} to PATH.`);
                }
                resolve();
            } else {
                reject(new Error(`Failed to install GitHub Copilot CLI. Exit code: ${code}`));
            }
        });

        proc.on('error', (err) => reject(new Error(`Failed to install GitHub Copilot CLI: ${err.message}`)));
    });
}

