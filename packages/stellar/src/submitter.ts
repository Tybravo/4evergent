import { Horizon, type Transaction } from "@stellar/stellar-sdk";
import { validateStellarNetwork, isLiveSubmitEnabled } from "./network-guard.js";
import { abortError, withAbortSignal } from "./abort.js";

/**
 * Submitter — broadcasts a signed Stellar transaction to the network.
 *
 * SUBMISSION PRECONDITIONS (enforced by the pipeline, NOT by this class):
 *   1. Intent passed IntentValidator
 *   2. PolicyEngine returned allow (no approval required) or approved
 *   3. StellarSimulator.simulate() returned success
 *   4. The Signer signed the transaction
 *   5. This is the ONLY code path that calls submitTransaction()
 *   6. Network validation passed (Testnet only)
 *   7. LIVE_SUBMIT=1 is explicitly set
 *
 * SECURITY: This class performs no signing — it accepts an already-signed Transaction.
 */
export class StellarSubmitter {
  private server: Horizon.Server;
  private horizonUrl: string;

  /**
   * @param horizonUrl Horizon endpoint (used when no server is injected).
   * @param server Optional `Horizon.Server` seam for tests — inject a fake to
   *        keep `submit()` fully offline. Production callers omit this.
   */
  constructor(horizonUrl: string, server?: Horizon.Server) {
    this.horizonUrl = horizonUrl;
    this.server = server ?? new Horizon.Server(horizonUrl);
  }

  /**
   * Submits a signed transaction to the Stellar network.
   *
   * @param signedTransaction  A signed Transaction object (MUST be signed).
   * @param networkPassphrase The expected network passphrase (for validation).
   * @param signal Optional cancellation signal. `submitTransaction()` has no
   *        SDK signal path, so it is raced against the signal: an abort rejects
   *        with AbortError and the response (if any) is discarded, so the
   *        caller never reports success for a cancelled submission.
   * @returns The transaction hash on success.
   * @throws Error if Horizon rejects the transaction or safety checks fail.
   */
  async submit(
    signedTransaction: Transaction,
    networkPassphrase: string,
    signal?: AbortSignal
  ): Promise<{ hash: string; ledger: number }> {
    // Phase 21: Network safety guard — validate before any network call
    const validation = validateStellarNetwork(this.horizonUrl, networkPassphrase);
    if (!validation.valid) {
      throw new Error(`StellarSubmitter: network validation failed: ${validation.reason}`);
    }

    // Phase 21: Live submission gate — must be explicitly enabled
    if (!isLiveSubmitEnabled()) {
      throw new Error(
        "StellarSubmitter: live submission is disabled. Set LIVE_SUBMIT=1 to enable real Testnet submission."
      );
    }

    // Verify the transaction has at least one signature — this is a sanity
    // check; the real gate is the pipeline not calling submit() on unsigned
    // transactions.
    const envelope = signedTransaction.toEnvelope();
    const signatures = envelope.v1().signatures;

    if (signatures.length === 0) {
      throw new Error(
        "StellarSubmitter: transaction has no signatures — signing required before submission"
      );
    }

    if (signal?.aborted) throw abortError();
    try {
      const result = await withAbortSignal(this.server.submitTransaction(signedTransaction), signal);
      return {
        hash: result.hash,
        ledger: result.ledger,
      };
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      // Horizon returns detailed error info on failure. We surface it so the
      // pipeline can record it and surface it to the operator.
      // SECURITY: Never include secret material in error messages.
      const detail = e?.response?.data?.detail ?? e?.message ?? "unknown submission error";
      throw new Error(`StellarSubmitter: submission failed: ${detail}`);
    }
  }
}
