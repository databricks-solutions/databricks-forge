# Connecting to Power BI / Microsoft Fabric via OAuth

**Databricks Forge -- Setup Guide**

---

## Overview

Databricks Forge connects to Power BI and Microsoft Fabric using the
**OAuth 2.0 client_credentials** flow (machine-to-machine, no user sign-in
required). An Entra ID (Azure AD) app registration acts as the service
principal that calls the Power BI REST APIs on your behalf.

Forge supports two access levels:

| Access Level | API Surface | Admin Required | Metadata Depth |
|---|---|---|---|
| **Admin Scanner** | `/admin/workspaces/*` | Yes (Fabric admin) | Full -- M expressions, sensitivity labels, lineage, Fabric artifacts |
| **Per-Workspace** | `/v1.0/myorg/groups/*` | No | Reduced -- no M expressions, no sensitivity labels |

Choose **Admin Scanner** when you want a full-tenant scan. Choose
**Per-Workspace** when admin consent is not available or you only need
specific workspaces.

---

## Prerequisites

- A Microsoft Entra ID tenant with at least **Application Developer** role
  (or higher) to create app registrations.
- For **Admin Scanner**: Fabric/Power BI admin access to enable the scanner
  APIs and add the service principal to an allowed security group.
- For **Per-Workspace**: the service principal must be added as a
  **Member** or **Admin** on each workspace you want to scan.
- A running Databricks Forge instance (local dev or Databricks App).

---

## Step 1 -- Register an Entra ID Application

1. Open the [Azure Portal](https://portal.azure.com) and navigate to
   **Microsoft Entra ID > App registrations > New registration**.
2. Set a meaningful name (e.g. `Databricks Forge -- PBI Scanner`).
3. Under **Supported account types**, select
   *Accounts in this organizational directory only (Single tenant)*.
4. Leave **Redirect URI** blank (not needed for client_credentials).
5. Click **Register**.

After registration, note two values from the **Overview** blade:

| Field | Where to Find | Used As |
|---|---|---|
| **Application (client) ID** | Overview blade | `clientId` in Forge |
| **Directory (tenant) ID** | Overview blade | `tenantId` in Forge |

---

## Step 2 -- Create a Client Secret

1. In the app registration, go to **Certificates & secrets > Client secrets**.
2. Click **New client secret**.
3. Set a description (e.g. `forge-scanner`) and an expiry period.
   Recommended: **12 months** or aligned with your org's rotation policy.
4. Click **Add** and **immediately copy the secret value** -- it will not
   be shown again.

This value is the `clientSecret` you will enter in Forge. It is encrypted
at rest in Lakebase and never returned to the frontend after creation.

---

## Step 3 -- Grant API Permissions

1. In the app registration, go to **API permissions > Add a permission**.
2. Select **APIs my organization uses**, then search for
   **Power BI Service** (AppId `00000009-0000-0000-c000-000000000000`).
3. Choose **Application permissions** (not delegated).

### Minimum permissions by access level

**Admin Scanner** (recommended for full-tenant scan):

| Permission | Purpose |
|---|---|
| `Tenant.Read.All` | List workspaces, run scanner API |
| `Tenant.ReadWrite.All` | *(Optional)* Only if you plan to use write-back features |

**Per-Workspace** (no admin APIs):

| Permission | Purpose |
|---|---|
| `Dataset.Read.All` | Read semantic models (datasets) |
| `Dashboard.Read.All` | Read dashboards and tiles |
| `Report.Read.All` | Read reports |
| `Workspace.Read.All` | List workspace contents |

4. After adding the permissions, click **Grant admin consent for [Tenant]**.
   A Global Admin or Privileged Role Administrator must approve this.

> **Tip:** If your admin is hesitant to grant `Tenant.Read.All`, start with
> the Per-Workspace permissions and add the service principal to individual
> workspaces instead.

---

## Step 4 -- Enable the Admin Scanner API (Admin Scanner only)

Skip this step if you chose **Per-Workspace** access.

1. Open the [Fabric Admin Portal](https://app.powerbi.com/admin-portal) or
   navigate to **Settings > Admin portal** in the Power BI service.
2. Go to **Tenant settings > Admin API settings**.
3. Enable the following toggles:

   - **Allow service principals to use read-only admin APIs** -- set to
     *Enabled* and restrict to a security group containing your service
     principal.
   - **Enhance admin APIs responses with detailed metadata** -- enables
     schema, expressions, and lineage in scan results.
   - **Enhance admin APIs responses with DAX and mashup expressions** --
     enables M/DAX extraction.

4. Create or use an existing **Entra ID security group** and add your app
   registration (service principal) as a member:
   - Entra ID > Groups > New group (Security type)
   - Add the app registration as a **member**
   - Use this group in the toggle restrictions above.

> Changes to tenant settings can take up to **15 minutes** to propagate.

---

## Step 5 -- Per-Workspace Access (Per-Workspace only)

Skip this step if you chose **Admin Scanner** access.

For each workspace you want to scan:

1. Open the workspace in Power BI service.
2. Click **Manage access** (or **Settings > Permissions**).
3. Add the service principal (search by app name) with **Member** or
   **Admin** role.

Alternatively, use the Power BI REST API or PowerShell to add the SP in
bulk:

```http
POST https://api.powerbi.com/v1.0/myorg/groups/{groupId}/users
Content-Type: application/json

{
  "identifier": "<client-id>",
  "groupUserAccessRight": "Member",
  "principalType": "App"
}
```

---

## Step 6 -- Add the Connection in Forge

1. In Databricks Forge, navigate to **Connections** (sidebar).
2. Click **Add Connection**.
3. Fill in the form:

   | Field | Value |
   |---|---|
   | **Connection Name** | A friendly label, e.g. `Production Power BI` |
   | **Access Level** | `Admin Scanner` or `Per-Workspace` |
   | **Tenant ID** | The Directory (tenant) ID from Step 1 |
   | **Client ID** | The Application (client) ID from Step 1 |
   | **Client Secret** | The secret value from Step 2 |

4. Click **Create Connection**.

### Test the Connection

Click **Test** on the connection card. Forge will:

1. Request an OAuth token from Entra ID using the client_credentials grant:
   ```
   POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
   grant_type=client_credentials
   client_id={clientId}
   client_secret={clientSecret}
   scope=https://analysis.windows.net/powerbi/api/.default
   ```
2. Call the Power BI REST API to list workspaces.
3. Report the number of accessible workspaces.

If the test fails, see the [Troubleshooting](#troubleshooting) section.

---

## Step 7 -- Run a Scan

1. Navigate to **Fabric / Power BI** (sidebar).
2. Select your connection from the dropdown.
3. Click **Full Scan** for a first-time scan, or **Quick Scan (changes only)**
   for incremental scans (Admin Scanner connections with a prior scan only).
4. Monitor progress in real-time via the progress bar.

### What the scan collects

| Artifact | Admin Scanner | Per-Workspace |
|---|---|---|
| Workspaces | All in tenant | Only those with SP access |
| Semantic Models (datasets) | Full schema + M expressions | Schema only |
| Reports | With tile details | With tile details |
| Dashboards | With tile details | With tile details |
| Measures | Full DAX expressions | Full DAX expressions |
| Sensitivity labels | Yes | No |
| Lineage | Yes | No |
| Fabric artifacts (lakehouses, notebooks, etc.) | Yes | No |

---

## How the OAuth Flow Works

```
┌──────────────┐     client_credentials     ┌──────────────────┐
│              │ ────────────────────────>   │                  │
│  Forge App   │   POST /oauth2/v2.0/token  │  Entra ID        │
│              │ <────────────────────────   │  (login.ms.com)  │
│              │     { access_token, ... }   │                  │
└──────┬───────┘                            └──────────────────┘
       │
       │  Bearer {access_token}
       ▼
┌──────────────────┐
│  Power BI REST   │
│  API             │
│  (api.powerbi.   │
│   com)           │
└──────────────────┘
```

- Tokens are cached in-memory per connection (5-minute refresh buffer).
- On a 401 response, the token is invalidated and re-acquired automatically.
- On a 429 (rate limit), Forge backs off with exponential delay and
  `Retry-After` header support.

---

## Troubleshooting

### "AADSTS7000215: Invalid client secret"

- The client secret has expired or was copied incorrectly.
- Generate a new secret in Entra ID and update the connection in Forge.

### "AADSTS700016: Application not found in tenant"

- The client ID is wrong, or the app registration was created in a
  different tenant.
- Verify the tenant ID and client ID match.

### "Unauthorized (403)" when listing workspaces

- **Admin Scanner**: The service principal's security group is not listed
  in the Fabric admin tenant settings, or the toggles are not enabled.
  Wait 15 minutes after making changes.
- **Per-Workspace**: The service principal has not been added to the
  workspace, or only has Viewer role (Member or Admin required).

### "Forbidden: Insufficient privileges to complete the operation"

- The API permissions have not been granted admin consent.
- Go to Entra ID > App registrations > API permissions and click
  **Grant admin consent**.

### Test succeeds but scan returns 0 workspaces

- **Admin Scanner**: Tenant settings are enabled but the security group
  restriction does not include your SP. Check the group membership.
- **Per-Workspace**: The SP has not been added to any workspaces yet.

### "429 Too Many Requests" during scan

- Power BI enforces per-app rate limits. Forge handles this automatically
  with exponential backoff (up to 3 retries). If the issue persists, reduce
  the number of concurrent workspace scans or wait and retry.

### Token works in Postman but not in Forge

- Ensure the scope is exactly `https://analysis.windows.net/powerbi/api/.default`
  (with the `/.default` suffix). Forge sets this automatically.
- Verify there is no conditional access policy blocking service principal
  sign-ins from the Forge app's network.

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Client secret at rest | AES-256 encrypted in Lakebase via `lib/connections/crypto.ts` |
| Client secret in transit | HTTPS only; never returned to frontend after creation |
| Token lifetime | Tokens are short-lived (~1 hour); cached with 5-min refresh buffer |
| Least privilege | Use `Tenant.Read.All` for read-only admin scan; no write permissions needed |
| Secret rotation | Rotate in Entra ID, then update the connection in Forge |
| Audit trail | All scan actions are logged with user email and timestamp |

---

## Secret Rotation Procedure

1. In Entra ID, go to the app registration > **Certificates & secrets**.
2. Create a **new** client secret (do not delete the old one yet).
3. In Forge, navigate to **Connections** and update the connection with the
   new secret.
4. Click **Test** to verify.
5. Delete the old secret in Entra ID.

---

## Quick Reference

```
Entra ID Token Endpoint:
  https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token

Power BI REST API Base:
  https://api.powerbi.com/v1.0/myorg

OAuth Scope:
  https://analysis.windows.net/powerbi/api/.default

Grant Type:
  client_credentials
```

---

## Further Reading

- [Power BI REST API reference](https://learn.microsoft.com/en-us/rest/api/power-bi/)
- [Entra ID app registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Power BI Admin Scanner API](https://learn.microsoft.com/en-us/power-bi/enterprise/service-admin-metadata-scanning)
- [Microsoft Fabric + Databricks integration](https://learn.microsoft.com/en-us/azure/databricks/partners/bi/fabric)
