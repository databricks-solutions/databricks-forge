# Contributing to Databricks Forge

Thank you for your interest in contributing! This community-maintained
Databricks Field Engineering accelerator welcomes contributions.

> **Note:** This is NOT an official Databricks product. See [NOTICE](NOTICE) for
> the full disclaimer.

## Getting Started

### Prerequisites

- [Node.js 20.9+](https://nodejs.org) and npm 10+
- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/install.html) installed and authenticated
- A Databricks workspace with Unity Catalog, a SQL Warehouse, and a Model Serving endpoint

### Development Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Authenticate with the Databricks CLI and provision local config:
   ```bash
   databricks auth login --host https://your-workspace.cloud.databricks.com
   bash .deploy_local.sh
   ```
   This creates `.env.local` with your workspace URL, warehouse, and Lakebase
   credentials. See the [Quick Start](docs/quickstart.md) for details.
4. Start the dev server (`prisma generate` runs automatically):
   ```bash
   npm run dev
   ```

### Running Checks

Before submitting a PR, make sure all checks pass:

```bash
npm run check:public  # Public-release hygiene
npm run format:check  # Prettier
npm run lint          # ESLint
npm run typecheck     # TypeScript strict mode
npm test              # Vitest unit tests
npm run test:quality  # Quality benchmark gate
npm run test:e2e      # Mocked browser tests
npm run build         # Production build
```

## How to Contribute

### Reporting Issues

- Search existing issues before opening a new one
- Include steps to reproduce, expected behaviour, and actual behaviour
- Include your Node.js version, OS, and browser (if relevant)
- Ask usage questions in
  [GitHub Discussions](https://github.com/databricks-solutions/databricks-forge/discussions)
- Report vulnerabilities through
  [GitHub private vulnerability reporting](https://github.com/databricks-solutions/databricks-forge/security/advisories/new),
  never a public issue

### Submitting Pull Requests

1. Create a feature branch from `main`:
   ```bash
   git switch main
   git pull --ff-only
   git switch -c feature/your-feature
   ```
2. Make your changes following the conventions below
3. Run the checks listed above
4. Write a clear PR description explaining **what** and **why**
5. Submit the PR against the `main` branch

### Code Conventions

- **TypeScript strict mode** -- no `any` unless absolutely necessary
- **No raw SQL in components** -- all SQL lives in `lib/queries/`
- **No hardcoded credentials** -- use environment variables
- **Loading, empty, and error states** on every page and async component
- **Prompt templates** include business context, metadata scope, and output format spec
- Follow existing file organisation (see `AGENTS.md` for the folder contract)

### Commit Messages

Write concise commit messages that describe the change and its purpose.
Use the imperative mood (e.g. "Add scoring calibration" not "Added scoring calibration").

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you agree to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the
[Databricks License](LICENSE).
