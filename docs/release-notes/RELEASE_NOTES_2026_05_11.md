# Release Notes -- 2026-05-11

**Databricks Forge v1.0.1**

---

## v1.0.1 -- Deploy hygiene: keep `.git/` out of the workspace

### Bug Fixes

- **Customer deploy failed on `.git/objects/pack/*.pack` >10 MB.**
  `databricks sync` was mirroring the entire repository, including the
  local `.git` directory, to `/Workspace/Users/<email>/databricks-forge/`.
  `databricks apps deploy --source-code-path` then tried to export every
  file under that path and hit the platform's 10 MB per-file limit on
  git pack files (one customer's pack was 23,206,202 bytes), aborting
  the deploy with `BAD_REQUEST: File size imported … exceeded max size`.
  `.databricksignore` now excludes `.git/` (and defensively
  `node_modules/`, `.next/`, `.venv-docs/`, and `*.tsbuildinfo`), and
  `deploy.sh` best-effort removes any pre-existing `.git` directory from
  the workspace before the first sync so previously affected
  deployments self-heal on the next `./deploy.sh`. No customer action
  required beyond pulling the fix and re-running deploy.

---

## All Commits

| Hash | Summary |
|---|---|
| _(pending)_ | fix(deploy): exclude `.git/` from `.databricksignore`, cleanup stale workspace `.git` |
