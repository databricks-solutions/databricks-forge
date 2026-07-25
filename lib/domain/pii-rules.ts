/**
 * Deterministic PII detection rules.
 *
 * Catches common PII patterns via column name matching (case-insensitive)
 * before the LLM pass runs. This ensures reliable detection of obvious
 * patterns that the LLM sometimes misses.
 *
 * These rules run first; the LLM pass then adds any additional
 * classifications the rules didn't catch.
 */

import type { SensitivityClassification } from "./types";

interface ColumnInput {
  name: string;
  type: string;
}

interface TableInput {
  fqn: string;
  columns: ColumnInput[];
}

// ---------------------------------------------------------------------------
// Pattern rules
// ---------------------------------------------------------------------------

interface PIIRule {
  /** Patterns to test against lowercased column name */
  patterns: RegExp[];
  classification: SensitivityClassification["classification"];
  confidence: "high" | "medium";
  reason: string;
  regulation: string | null;
}

const PII_RULES: PIIRule[] = [
  // Email addresses
  {
    patterns: [/email/, /e_mail/, /email_address/, /emailaddress/, /mail_addr/],
    classification: "PII",
    confidence: "high",
    reason: "Column name indicates email address — directly identifies individuals",
    regulation: "GDPR",
  },
  // Phone numbers
  {
    patterns: [/phone/, /mobile/, /cell_number/, /telephone/, /fax/, /tel_no/],
    classification: "PII",
    confidence: "high",
    reason: "Column name indicates phone number — directly identifies individuals",
    regulation: "GDPR",
  },
  // Social Security / National ID
  {
    patterns: [/\bssn\b/, /social_security/, /national_id/, /\bnin\b/, /sin_number/, /\btfn\b/],
    classification: "PII",
    confidence: "high",
    reason: "Column name indicates government-issued identifier",
    regulation: "GDPR",
  },
  // Names
  {
    patterns: [
      /first_name/,
      /last_name/,
      /full_name/,
      /given_name/,
      /surname/,
      /family_name/,
      /^name$/,
      /customer_name/,
      /patient_name/,
      /employee_name/,
    ],
    classification: "PII",
    confidence: "high",
    reason: "Column name indicates personal name",
    regulation: "GDPR",
  },
  // Physical address
  {
    patterns: [
      /street_address/,
      /home_address/,
      /mailing_address/,
      /postal_code/,
      /zip_code/,
      /\baddress_line/,
      /\baddr\b/,
    ],
    classification: "PII",
    confidence: "high",
    reason: "Column name indicates physical address",
    regulation: "GDPR",
  },
  // Date of birth / Age
  {
    patterns: [/date_of_birth/, /\bdob\b/, /birth_date/, /birthdate/],
    classification: "PII",
    confidence: "high",
    reason: "Column name indicates date of birth",
    regulation: "GDPR",
  },
  // Credit card / Payment
  {
    patterns: [/credit_card/, /card_number/, /\bccn\b/, /\bpan\b/, /card_num/, /payment_card/],
    classification: "Financial",
    confidence: "high",
    reason: "Column name indicates payment card number",
    regulation: "PCI-DSS",
  },
  // Bank account
  {
    patterns: [
      /bank_account/,
      /\biban\b/,
      /routing_number/,
      /account_number/,
      /sort_code/,
      /\bswift\b/,
    ],
    classification: "Financial",
    confidence: "high",
    reason: "Column name indicates banking details",
    regulation: "PCI-DSS",
  },
  // Health / Medical
  {
    patterns: [
      /diagnosis/,
      /medical_record/,
      /\bmrn\b/,
      /patient_id/,
      /health_condition/,
      /prescription/,
      /icd_code/,
      /medication/,
    ],
    classification: "Health",
    confidence: "high",
    reason: "Column name indicates health/medical data",
    regulation: "HIPAA",
  },
  // IP address / Device identifiers
  {
    patterns: [/ip_address/, /\bip_addr\b/, /device_id/, /mac_address/],
    classification: "PII",
    confidence: "medium",
    reason: "Column name indicates device or network identifier — can be used for tracking",
    regulation: "GDPR",
  },
  // Passwords / Auth
  {
    patterns: [
      /password/,
      /\bpasswd\b/,
      /secret_key/,
      /api_key/,
      /access_token/,
      /auth_token/,
      /\bhash\b.*pass/,
    ],
    classification: "Authentication",
    confidence: "high",
    reason: "Column name indicates authentication credential",
    regulation: null,
  },
  // Salary / Income
  {
    patterns: [/salary/, /income/, /wage/, /compensation/, /bonus_amount/],
    classification: "Financial",
    confidence: "medium",
    reason: "Column name indicates compensation data",
    regulation: null,
  },
  // Passport / Driver's license
  {
    patterns: [/passport/, /driver_license/, /driving_licence/, /license_number/],
    classification: "PII",
    confidence: "high",
    reason: "Column name indicates government-issued identity document",
    regulation: "GDPR",
  },
  // Tax information
  {
    patterns: [/tax_id/, /\btin\b/, /vat_number/, /ein\b/],
    classification: "Financial",
    confidence: "high",
    reason: "Column name indicates tax identifier",
    regulation: "GDPR",
  },
];

// ---------------------------------------------------------------------------
// Detection function
// ---------------------------------------------------------------------------

/**
 * Run deterministic PII rules against table/column names.
 * Returns classifications for columns that match known PII patterns.
 */
export function detectPIIDeterministic(tables: TableInput[]): SensitivityClassification[] {
  const results: SensitivityClassification[] = [];

  for (const table of tables) {
    for (const col of table.columns) {
      const lowerName = col.name.toLowerCase();

      for (const rule of PII_RULES) {
        if (rule.patterns.some((p) => p.test(lowerName))) {
          results.push({
            tableFqn: table.fqn,
            columnName: col.name,
            classification: rule.classification,
            confidence: rule.confidence,
            reason: `[Rule-based] ${rule.reason}`,
            regulation: rule.regulation,
          });
          break; // Only one classification per column
        }
      }
    }
  }

  return results;
}
