# Creating an Azure DevOps Custom Pipeline Task (TypeScript)

A concise reference for building, packaging, and publishing a custom ADO pipeline task.

---

## Prerequisites

```bash
npm install -g tfx-cli        # Azure DevOps extension packaging tool
npm install -g typescript
```

You also need:
- A **Visual Studio Marketplace publisher account** (free) — create at https://marketplace.visualstudio.com/manage
- Node.js 18+

---

## 1. Project Structure

```
my-extension/                   # Root (also the extension package root)
├── vss-extension.json          # Extension manifest (publisher, version, metadata)
├── package.json                # Root scripts: build, package
├── README.md                   # Shown on Marketplace listing
├── images/
│   └── extension-icon.png      # 128x128 PNG, shown in Marketplace
└── MyTaskV1/                   # One folder per task (versioned)
    ├── task.json               # Task manifest (inputs, execution target)
    ├── package.json            # Task dependencies
    ├── tsconfig.json           # TypeScript config
    └── src/
        └── index.ts            # Task entry point
```

> Name the task folder with a version suffix (e.g. `MyTaskV1`) — ADO uses this to support multiple major versions side-by-side.

---

## 2. Initial Setup

```bash
mkdir my-extension && cd my-extension

# Root package (build/package scripts only)
npm init -y

# Task folder
mkdir MyTaskV1 && cd MyTaskV1
npm init -y
npm install azure-pipelines-task-lib
npm install --save-dev typescript @types/node
```

---

## 3. Key Configuration Files

### `MyTaskV1/tsconfig.json`

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "commonjs",
        "strict": true,
        "esModuleInterop": true,
        "outDir": ".",
        "rootDir": "src"
    },
    "include": ["src/**/*.ts"]
}
```

`outDir: "."` compiles JS files alongside `task.json` at the task root — required by ADO's Node executor.

### `MyTaskV1/task.json`

```json
{
    "$schema": "https://raw.githubusercontent.com/Microsoft/azure-pipelines-task-lib/master/tasks.schema.json",
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "name": "MyTask",
    "friendlyName": "My Task",
    "description": "What this task does",
    "author": "YourName",
    "version": { "Major": 1, "Minor": 0, "Patch": 0 },
    "instanceNameFormat": "My Task",
    "minimumAgentVersion": "2.182.1",
    "inputs": [
        {
            "name": "myInput",
            "type": "string",
            "label": "My Input",
            "required": true,
            "helpMarkDown": "Description shown in the pipeline UI"
        },
        {
            "name": "mySecret",
            "type": "string",
            "label": "Secret Value",
            "required": false,
            "isSecret": true
        },
        {
            "name": "myFlag",
            "type": "boolean",
            "label": "Enable Feature",
            "defaultValue": false
        }
    ],
    "execution": {
        "Node20_1": {
            "target": "index.js"
        }
    }
}
```

Generate a GUID for `id` — it uniquely identifies your task and must never change after publishing. Use `node -e "const {randomUUID} = require('crypto'); console.log(randomUUID())"`.

**Input types:** `string`, `boolean`, `filePath`, `multiLine`, `pickList`, `radio`

### `vss-extension.json`

```json
{
    "$schema": "http://json.schemastore.org/vss-extension",
    "manifestVersion": 1,
    "id": "my-extension",
    "name": "My Extension",
    "version": "1.0.0",
    "publisher": "YourPublisherID",
    "public": false,
    "targets": [{ "id": "Microsoft.VisualStudio.Services" }],
    "description": "Short description for Marketplace",
    "categories": ["Azure Pipelines"],
    "icons": { "default": "images/extension-icon.png" },
    "content": { "details": { "path": "README.md" } },
    "files": [{ "path": "MyTaskV1" }],
    "contributions": [
        {
            "id": "my-task",
            "type": "ms.vss-distributed-task.task",
            "targets": ["ms.vss-distributed-task.tasks"],
            "properties": { "name": "MyTaskV1" }
        }
    ]
}
```

`"public": false` keeps it private during development. Set to `true` when ready to publish publicly.

---

## 4. Task Entry Point (`src/index.ts`)

```typescript
import * as tl from 'azure-pipelines-task-lib/task';

async function run(): Promise<void> {
    try {
        const myInput = tl.getInput('myInput', true)!;
        const myFlag = tl.getBoolInput('myFlag', false);

        // Access pipeline variables
        const buildId = tl.getVariable('Build.BuildId');

        console.log(`Running with input: ${myInput}`);

        // Your task logic here

        tl.setResult(tl.TaskResult.Succeeded, 'Task completed.');
    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, `Task failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

run();
```

**Key `task-lib` APIs:**
| Method | Purpose |
|--------|---------|
| `tl.getInput(name, required?)` | Read a string input |
| `tl.getBoolInput(name, required?)` | Read a boolean input |
| `tl.getVariable(name)` | Read a pipeline variable |
| `tl.setResult(result, message)` | Set task pass/fail |
| `tl.setVariable(name, value)` | Set a pipeline variable for downstream tasks |
| `tl.which(tool, required?)` | Find a tool on PATH |
| `tl.exec(tool, args)` | Run a command |

---

## 5. Version Sync

Keep these in sync — ADO cross-references them:

| File | Field |
|------|-------|
| `vss-extension.json` | `"version"` |
| `MyTaskV1/task.json` | `"version": { "Major", "Minor", "Patch" }` |
| `package.json` (root) | `"version"` |
| `MyTaskV1/package.json` | `"version"` |

Increment the **Major** version in `task.json` for breaking changes so users can pin `MyTask@1` vs `MyTask@2`.

---

## 6. Build & Package

### `package.json` (root) scripts

```json
{
    "scripts": {
        "build": "cd MyTaskV1 && tsc",
        "package": "tfx extension create --manifest-globs vss-extension.json"
    }
}
```

```bash
npm run build     # Compiles TypeScript → JS inside MyTaskV1/
npm run package   # Produces Publisher.my-extension-1.0.0.vsix
```

The `.vsix` is a zip of everything under `files` in `vss-extension.json`. The compiled `.js` files must exist inside the task folder before packaging.

---

## 7. Visual Studio Marketplace Setup

1. Create a publisher at https://marketplace.visualstudio.com/manage
   - Choose a publisher ID (used in `vss-extension.json` as `"publisher"`)
2. Upload your `.vsix`:
   - Click **New extension > Azure DevOps**
   - Drag and drop the `.vsix`
3. For **private** extensions: share with specific organisations via **Share** on the extension page
4. For **public** extensions: submit for review (requires Microsoft verification)

**Required assets for a good listing:**
- `images/extension-icon.png` — 128×128 PNG
- `README.md` — becomes the Marketplace detail page
- `description` field in `vss-extension.json` — shown in search results

---

## 8. Installing in Azure DevOps

**Private extension:**
1. Go to **Organisation Settings > Extensions**
2. Click **Browse Marketplace**, find your shared extension, install it

**Public extension:**
1. Find it on the Marketplace, click **Get it free**, select your organisation

After install, the task is available in all pipelines in that organisation:

```yaml
- task: MyTask@1
  inputs:
    myInput: 'hello'
    myFlag: true
```

---

## 9. Updating a Published Extension

```bash
# Bump version in all 4 files, then:
npm run build
npm run package
# Upload new .vsix to Marketplace — installed organisations get it automatically
```

For breaking changes, create `MyTaskV2/` with a new GUID and a new contribution entry in `vss-extension.json`. Existing pipelines using `MyTask@1` are unaffected.

---

## 10. Local Testing

```bash
# Set inputs as environment variables (INPUT_ prefix + uppercase name)
export INPUT_MYINPUT="test value"
export INPUT_MYFLAG="true"

# Set any pipeline variables your task reads
export BUILD_BUILDID="123"

cd MyTaskV1
node index.js
```
