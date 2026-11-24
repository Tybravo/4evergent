import type { AgentIntent, PolicyRules } from "@4evergent/shared";
import { isValidStellarEd25519PublicKey } from "./validation.js";

/**
 * Canonical asset identity for policy configuration, enforcement, and reporting.
 *
 * Every policy surface uses the same string key for a given asset:
 *   - native XLM: "XLM"
 *   - issued asset (payment): "CODE:ISSUER"
 *   - trustline: "trustline:CODE:ISSUER"
 *
 * "native" is accepted as a legacy lookup key in maxTxAmount/dailySpendingLimit
 * but is not an asset identity and is not accepted in allowedAssets.
 */

const ASSET_CODE_RE = /^[A-Za-z0-9_]{1,12}$/;

export function isCanonicalAllowedAsset(value: string): boolean {
  if (value === "XLM") return true;
  if (value.startsWith("trustline:")) {
    const rest = value.slice("trustline:".length);
    const parts = rest.split(":");
    if (parts.length !== 2) return false;
    const [code, issuer] = parts;
    return ASSET_CODE_RE.test(code ?? "") && isValidStellarEd25519PublicKey(issuer ?? "");
  }
  const parts = value.split(":");
  if (parts.length !== 2) return false;
  const [code, issuer] = parts;
  return ASSET_CODE_RE.test(code ?? "") && isValidStellarEd25519PublicKey(issuer ?? "");
}

export function isCanonicalPolicyLimitKey(value: string): boolean {
  if (value === "XLM" || value === "native") return true;
  return isCanonicalAllowedAsset(value);
}

/**
 * Resolve an intent to its canonical asset identity.
 *
 * Returns null for intents that carry no asset (contract_call, account_settings)
 * or for asset-bearing intents whose identity cannot be resolved canonically.
 */
export function extractAssetIdentity(intent: AgentIntent, rules?: PolicyRules): string | null {
  if (intent.type === "payment") {
    const details = (intent as any).assetDetails;
    if (details && typeof details.code === "string" && typeof details.issuer === "string") {
      if (details.code.toUpperCase() === "XLM" && !details.issuer) {
        return "XLM";
      }
      if (details.code.toUpperCase() === "XLM") {
        return "XLM";
      }
      return `${details.code}:${details.issuer}`;
    }
    const asset = (intent as any).asset;
    if (typeof asset !== "string" || asset.trim() === "") return null;
    const trimmed = asset.trim();
    if (trimmed.toUpperCase() === "XLM") return "XLM";
    if (trimmed.includes(":")) {
      const [code, issuer] = trimmed.split(":");
      if (code && issuer && ASSET_CODE_RE.test(code) && isValidStellarEd25519PublicKey(issuer)) {
        return `${code}:${issuer}`;
      }
      return null;
    }
    // Bare non-native code: resolve only if policy names exactly one issuer.
    if (rules) {
      const candidates = Object.keys(rules.maxTxAmount ?? {}).filter((key) =>
        key.startsWith(`${trimmed}:`)
      );
      const dailyCandidates = Object.keys(rules.dailySpendingLimit ?? {}).filter((key) =>
        key.startsWith(`${trimmed}:`)
      );
      const all = new Set([...candidates, ...dailyCandidates]);
      if (all.size === 1) return [...all][0]!;
    }
    return null;
  }

  if (intent.type === "trustline") {
    const code = (intent as any).assetCode;
    const issuer = (intent as any).issuer;
    if (typeof code === "string" && typeof issuer === "string") {
      if (code.toUpperCase() === "XLM") return "XLM";
      if (ASSET_CODE_RE.test(code) && isValidStellarEd25519PublicKey(issuer)) {
        return `trustline:${code}:${issuer}`;
      }
    }
    return null;
  }

  return null;
}
