# Contributing to Copilot PR Review for Azure DevOps

Thank you for your interest in contributing to this project!

## Development Setup

### Prerequisites

- Node.js 20 or later
- npm
- TypeScript (`npm install -g typescript`)
- TFX CLI (`npm install -g tfx-cli`)

### Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/biswajitsamal59/ado-copilot-code-review.git
   cd ado-copilot-code-review
   ```

2. Install dependencies:
   ```bash
   cd CopilotPRReviewV1
   npm install
   ```

3. Compile TypeScript:
   ```bash
   npm run build
   ```

### Building the Extension

1. Ensure you have a valid PNG icon at `images/extension-icon.png` (minimum 128x128 pixels)

2. From the root directory, package the extension:
   ```bash
   tfx extension create --manifest-globs vss-extension.json
   ```

3. This creates a `.vsix` file that can be uploaded to the Azure DevOps Marketplace

### Testing Locally

1. Set environment variables for testing:
   ```powershell
   $env:INPUT_GITHUBPAT = "your-github-pat"
   $env:INPUT_AZUREDEVOPSPAT = "your-ado-pat"
   $env:INPUT_ORGANIZATION = "your-org"
   $env:INPUT_PROJECT = "your-project"
   $env:INPUT_REPOSITORY = "your-repo"
   $env:INPUT_PULLREQUESTID = "123"
   ```

2. Run the task:
   ```bash
   cd CopilotPRReviewV1
   node index.js
   ```

### Project Structure

```
copilot-pr-review/
├── vss-extension.json          # Extension manifest
├── README.md                   # Documentation
├── LICENSE                     # GPL-3.0 License
├── CONTRIBUTING.md             # This file
├── .gitignore
├── images/
│   └── extension-icon.png      # Extension icon (128x128+)
└── CopilotPRReviewV1/
    ├── task.json               # Task definition
    ├── package.json            # Node.js dependencies
    ├── tsconfig.json           # TypeScript config
    └── src/
        ├── index.ts            # Main orchestrator
        ├── ado-api/            # Azure DevOps REST API modules
        ├── agents/             # CLI agent runner (Copilot)
        ├── context/            # PR context and diff fetching
        ├── scripts/            # Standalone CLI scripts for comment management
        ├── utils/              # Utilities (HTML stripping, diff, prompt)
        └── scripts/
            ├── prompt.txt      # Default Copilot prompt
            └── prompt-custom.txt # Custom prompt template
```

### Code Style

- Use TypeScript for all logic
- Follow existing code patterns and formatting

### Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test locally
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

### Reporting Issues

Please use GitHub Issues to report bugs or request features. Include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (agent OS, Node version, etc.)

## License

By contributing, you agree that your contributions will be licensed under the GPL-3.0 License.
