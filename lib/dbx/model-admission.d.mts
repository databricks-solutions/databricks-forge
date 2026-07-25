export const DEFAULT_MODEL_ENDPOINT: string;
export const KNOWN_MODEL_KEYS: readonly string[];

export interface RuntimeAdmittedEndpoint {
  name: string;
  knownModelKey: string;
  required: boolean;
}

export interface RuntimeEndpointAdmission {
  admitted: RuntimeAdmittedEndpoint[];
  rejected: string[];
  allowlistFallback: boolean;
}

export type EndpointValidationState = "completed" | "auth_skipped" | "not_run";

export interface EndpointReadiness {
  state: EndpointValidationState;
  shouldStart: boolean;
  admittedCount: number;
  admittedRequiredCount: number;
  usableRequiredCount: number;
}

export function findKnownModelKey(name: string): string | null;
export function runtimeEndpointAdmission(
  env?: Record<string, string | undefined>,
): RuntimeEndpointAdmission;
export function runtimeAdmittedEndpointNames(env?: Record<string, string | undefined>): string[];
export function evaluateEndpointReadiness(
  env?: Record<string, string | undefined>,
): EndpointReadiness;
