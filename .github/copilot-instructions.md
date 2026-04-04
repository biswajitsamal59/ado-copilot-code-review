# Copilot Instructions for ado-copilot-code-review

## Project Overview

Azure DevOps pipeline extension that automates PR code reviews using GitHub Copilot CLI or Claude Code CLI. The extension fetches PR details via Azure DevOps REST API, invokes the configured CLI agent for analysis, and posts review comments back to the PR.

## Architecture

```
CopilotPRReviewV1/src/
├── index.ts                  # Main orchestrator (~220 lines)
├── ado-api/
│   ├── client.ts             # Shared REST client (auth, fetch, errors)
│   ├── pull-requests.ts      # PR details, threads, iterations, commits
│   ├── work-items.ts         # Work item batch fetch + HTML stripping
│   └── comments.ts           # Create/update/delete comment threads
├── context/
│   ├── pr-context.ts         # Orchestrates context file generation
│   └── diff-fetcher.ts       # Fetches actual file diffs from ADO API
├── agents/
│   ├── installer.ts          # CLI check + install (Copilot & Claude)
│   ├── copilot.ts            # Spawn copilot CLI
│   └── claude.ts             # Spawn claude CLI + stream-json parser
├── scripts/
│   ├── add-comment.ts        # Standalone CLI script for posting comments
│   ├── update-comment.ts     # Standalone CLI script for updating comments
│   └── delete-comment.ts     # Standalone CLI script for deleting comments
└── utils/
    ├── html.ts               # HTML tag stripping
    ├── prompt.ts             # Prompt resolution + validation
    └── diff.ts               # Myers diff algorithm
```

## Build & Development

```bash
# Build TypeScript (from repo root)
npm run build                     # Compiles CopilotPRReviewV1/src/ → JS output

# Build dev extension for testing
pwsh -File build-dev.ps1          # Builds + copies to CopilotPRReviewDevV1 + packages
pwsh -File build-dev.ps1 -SkipBuild  # Package only

# Package for marketplace
npm run package:prod              # Creates .vsix from vss-extension.json
```

**Version Sync**: Update version in FOUR places: root `package.json`, `CopilotPRReviewV1/package.json`, `CopilotPRReviewV1/task.json`, and `vss-extension.json`.

## Code Patterns

### Authentication Handling
Two auth modes:
- `Bearer` - OAuth via `System.AccessToken` (recommended for cloud)
- `Basic` - PAT with base64 encoding (required for on-prem)

### Prompt Customization
- Default prompt: `CopilotPRReviewV1/scripts/prompt.txt`
- Custom prompt template: `CopilotPRReviewV1/scripts/prompt-custom.txt` uses `%CUSTOMPROMPT%` placeholder
- **Constraint**: Custom prompts cannot contain double quotes (`"`) - validated in index.ts

### Comment Status Convention
- `Active` (1) = Feedback requiring changes
- `Closed` (4) = Positive feedback or approval
- `Fixed` (2) = Auto-resolved previous comments

### Copilot CLI Flags
```bash
copilot -p "$prompt" --allow-all-paths --allow-all-tools --deny-tool 'shell(git push)'
```

## Task Configuration

Inputs defined in `CopilotPRReviewV1/task.json`. Key auto-detected values:
- `organization` - Extracted from `System.CollectionUri`
- `project` - Defaults to `$(System.TeamProject)`
- `pullRequestId` - Falls back to `$(System.PullRequest.PullRequestId)`

## Testing Locally

```powershell
$env:INPUT_GITHUBPAT = "ghp_..."
$env:INPUT_USESYSTEMACCESSTOKEN = "false"
$env:INPUT_AZUREDEVOPSPAT = "ado-pat"
$env:INPUT_ORGANIZATION = "myorg"
$env:INPUT_PROJECT = "myproject"
$env:INPUT_REPOSITORY = "myrepo"
$env:INPUT_PULLREQUESTID = "123"

cd CopilotPRReviewV1
node index.js
```

## Publishing to Marketplace

1. **Bump version** in all 4 locations (see Version Sync above)
2. **Build and package**:
   ```bash
   npm run build
   npm run package:prod
   ```
3. **Upload** to [Azure DevOps Marketplace Publisher Portal](https://marketplace.visualstudio.com/manage/publishers)
4. **Dev testing**: Use `build-dev.ps1` to create a separate dev extension that can be installed alongside production
