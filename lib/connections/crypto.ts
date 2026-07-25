/**
 * Symmetric encryption utilities for connection secrets stored in Lakebase.
 *
 * Uses AES-256-GCM with a key derived from FORGE_ENCRYPTION_KEY
 * (falls back to DATABRICKS_CLIENT_SECRET if not set).
 * The IV + auth tag are prepended to the ciphertext and stored as
 * a single hex string: <iv:24><tag:32><ciphertext:*>.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const raw = process.env.FORGE_ENCRYPTION_KEY || process.env.DATABRICKS_CLIENT_SECRET || "";
  if (!raw) {
    throw new Error(
      "No encryption key available. Set FORGE_ENCRYPTION_KEY or DATABRICKS_CLIENT_SECRET.",
    );
  }
  return createHash("sha256").update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

export function decrypt(hex: string): string {
  const key = deriveKey();
  const buf = Buffer.from(hex, "hex");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
