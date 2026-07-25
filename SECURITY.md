# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it
responsibly. **Do not open a public GitHub issue.**

### How to Report

Email your report to the maintainers with the subject line
**"[SECURITY] Databricks Forge"**. Include:

- A description of the vulnerability
- Steps to reproduce or a proof of concept
- The potential impact
- Any suggested fix (optional)

### What to Expect

- **Acknowledgement** within 5 business days
- **Status update** within 15 business days
- We will coordinate disclosure timing with you

### Scope

This policy covers the code in this repository. It does **not** cover:

- The Databricks platform itself (report those via
  [Databricks Security](https://www.databricks.com/trust/security))
- Third-party dependencies (report those to the upstream project)

## Security Architecture

For details on the application's security design, data flows, and threat
mitigations, see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md).

## Supported Versions

Only the latest version on the `dev` branch receives security fixes.

| Version | Supported |
| ------- | --------- |
| Latest `dev` | Yes |
| Older commits | No |
