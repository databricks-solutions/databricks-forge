/**
 * Connection types for external platform integrations.
 */

export type ConnectorType = "fabric";

export type AccessLevel = "admin" | "workspace";

export interface ConnectionConfig {
  id: string;
  name: string;
  connectorType: ConnectorType;
  accessLevel: AccessLevel;
  tenantId: string;
  clientId: string;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastTestedAt: string | null;
  lastScanCompletedAt: string | null;
  workspaceFilter?: string[];
}

export interface ConnectionSummary {
  id: string;
  name: string;
  connectorType: ConnectorType;
  accessLevel: AccessLevel;
  tenantId: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  lastTestedAt: string | null;
  lastScanCompletedAt: string | null;
}

export interface CreateConnectionInput {
  name: string;
  connectorType: ConnectorType;
  accessLevel: AccessLevel;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceFilter?: string[];
}

export interface UpdateConnectionInput {
  name?: string;
  clientSecret?: string;
  workspaceFilter?: string[];
  status?: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  workspaces?: Array<{ id: string; name: string }>;
}
