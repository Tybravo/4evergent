import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  type Horizon,
  type Transaction,
  type rpc,
} from "@stellar/stellar-sdk";
import { StellarSimulator } from "../src/simulator.js";
import { StellarTransactionBuilder } from "../src/transaction-builder.js";
import { StellarSubmitter } from "../src/submitter.js";
import { TransactionPipeline } from "../src/pipeline.js";
import type { Signer } from "../src/signer.js";
import { InMemoryActivityStore, InMemoryApprovalStore } from "@4evergent/database";
import type { AgentIntent } from "@4evergent/shared";

const TESTNET = "https://horizon-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const SOURCE = Keypair.random().publicKey();
const DEST = Keypair.random().publicKey();
const CONTRACT = "CDXQRPVGMPJB5UXQHKFAPBLK6G37DSVKDW2BKRAF76RO5ENCCB4W3QX7";

function buildTx(accountSequence = "100"): Transaction {
  return new TransactionBuilder(new Account(SOURCE, accountSequence), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: DEST, asset: Asset.native(), amount: "10" }))
    .setTimeout(30)
    .build();
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function accountCall(id: string): Promise<any> {
  if (id === SOURCE) {
    return Promise.resolve({
      sequence: "100",
      subentry_count: 0,
      balances: [{ asset_type: "native", balance: "100.0000000" }],
    });
  }
  return Promise.resolve({
    sequence: "5",
    subentry_count: 0,
    balances: [{ asset_type: "native", balance: "100.0000000" }],
  });
}

function horizonServer(overrides: {
  fee?: () => Promise<number>;
  account?: (id: string) => Promise<any>;
} = {}): Horizon.Server {
  return {
    fetchBaseFee: overrides.fee ?? (async () => 100),
    accounts: () => ({
      accountId: (id: string) => ({ call: () => (overrides.account ?? accountCall)(id) }),
    }),
    submitTransaction: () => never(),
  } as unknown as Horizon.Server;
}

async function expectAbortWithin(
  t: TestContext,
  label: string,
  promise: Promise<unknown>,
  limitMs = 1000
): Promise<void> {
  const start = performance.now();
  await assert.rejects(promise, (err: any) => err?.name === "AbortError");
  const elapsed = performance.now() - start;
  t.diagnostic(`${label}: AbortError after ${elapsed.toFixed(1)}ms (limit ${limitMs}ms)`);
  assert.ok(elapsed < limitMs, `expected AbortError within ${limitMs}ms, got ${elapsed.toFixed(1)}ms`);
}

function abortAfter(controller: AbortController, delayMs = 20): void {
  setTimeout(() => controller.abort(), delayMs);
}

async function withLiveSubmit(fn: () => Promise<void>): Promise<void> {
  const original = process.env.LIVE_SUBMIT;
  process.env.LIVE_SUBMIT = "1";
  try {
    await fn();
  } finally {
    if (original === undefined) delete process.env.LIVE_SUBMIT;
    else process.env.LIVE_SUBMIT = original;
  }
}

test("SIMULATOR: abort during base-fee fetch rejects promptly with AbortError", async (t) => {
  const server = horizonServer({ fee: () => never<number>() });
  const simulator = new StellarSimulator(TESTNET, server);
  const controller = new AbortController();
  const pending = simulator.simulate(buildTx(), controller.signal);
  abortAfter(controller);
  await expectAbortWithin(t, "hung fetchBaseFee", pending);
});

test("SIMULATOR: abort during source-account load rejects promptly with AbortError", async (t) => {
  const server = horizonServer({ account: () => never() });
  const simulator = new StellarSimulator(TESTNET, server);
  const controller = new AbortController();
  const pending = simulator.simulate(buildTx(), controller.signal);
  abortAfter(controller);
  await expectAbortWithin(t, "hung source account load", pending);
});

test("SIMULATOR: abort during destination-account load rejects promptly with AbortError", async (t) => {
  const server = horizonServer({
    account: (id) => (id === SOURCE ? accountCall(id) : never()),
  });
  const simulator = new StellarSimulator(TESTNET, server);
  const controller = new AbortController();
  const pending = simulator.simulate(buildTx(), controller.signal);
  abortAfter(controller);
  await expectAbortWithin(t, "hung destination account load", pending);
});

test("SIMULATOR: abort during Soroban RPC simulation rejects promptly with AbortError", async (t) => {
  const soroban = { simulateTransaction: () => never() } as unknown as rpc.Server;
  const simulator = new StellarSimulator(TESTNET, horizonServer(), soroban);
  const tx = await new StellarTransactionBuilder().buildContractCall(
    new Account(SOURCE, "100"),
    {
      type: "contract_call",
      contractId: CONTRACT,
      function: "ping",
      args: [],
      reason: "abort test",
    },
    PASSPHRASE
  );
  const controller = new AbortController();
  const pending = simulator.simulate(tx, controller.signal);
  abortAfter(controller);
  await expectAbortWithin(t, "hung Soroban simulateTransaction", pending);
});

test("SIMULATOR: no-abort happy path is unchanged", async () => {
  const simulator = new StellarSimulator(TESTNET, horizonServer());
  const result = await simulator.simulate(buildTx());
  assert.deepEqual(result, {
    success: true,
    fee: "100",
    operations: 1,
    warnings: [],
  });
});

test("SUBMITTER: abort during submission rejects promptly and reports no success", async (t) => {
  let submitCalls = 0;
  let releasedBeforeError = false;
  const server = {
    submitTransaction: () => {
      submitCalls++;
      return never().finally(() => {
        releasedBeforeError = true;
      });
    },
  } as unknown as Horizon.Server;
  const submitter = new StellarSubmitter(TESTNET, server);
  const tx = buildTx();
  tx.sign(Keypair.random());
  const controller = new AbortController();

  await withLiveSubmit(async () => {
    const pending = submitter.submit(tx, PASSPHRASE, controller.signal);
    abortAfter(controller);
    await expectAbortWithin(t, "hung submitTransaction", pending);
  });
  assert.equal(submitCalls, 1, "submission started before the abort");
  assert.equal(releasedBeforeError, false, "the hung request has not settled, so its result is discarded");
});

test("SUBMITTER: pre-aborted signal never reaches submitTransaction", async () => {
  let submitCalls = 0;
  const server = {
    submitTransaction: () => {
      submitCalls++;
      return never();
    },
  } as unknown as Horizon.Server;
  const submitter = new StellarSubmitter(TESTNET, server);
  const tx = buildTx();
  tx.sign(Keypair.random());
  const controller = new AbortController();
  controller.abort();

  await withLiveSubmit(async () => {
    await assert.rejects(
      submitter.submit(tx, PASSPHRASE, controller.signal),
      (err: any) => err?.name === "AbortError"
    );
  });
  assert.equal(submitCalls, 0, "abort before submission must not call submitTransaction");
});

test("SUBMITTER: no-abort happy path is unchanged", async () => {
  const server = {
    submitTransaction: async () => ({ hash: "abc123", ledger: 42 }),
  } as unknown as Horizon.Server;
  const submitter = new StellarSubmitter(TESTNET, server);
  const tx = buildTx();
  tx.sign(Keypair.random());

  await withLiveSubmit(async () => {
    assert.deepEqual(await submitter.submit(tx, PASSPHRASE), { hash: "abc123", ledger: 42 });
  });
});

class RecordingSigner implements Signer {
  calls = 0;
  private keypair = Keypair.random();

  getAccountId(): string {
    return this.keypair.publicKey();
  }

  getNetworkPassphrase(): string {
    return PASSPHRASE;
  }

  async sign(transaction: any): Promise<any> {
    this.calls++;
    transaction.sign(this.keypair);
    return transaction;
  }
}

function paymentIntent(amount = "10"): AgentIntent {
  return {
    type: "payment",
    asset: "XLM",
    destination: Keypair.random().publicKey(),
    amount,
    reason: "abort test",
  };
}

function fakeAccount(): any {
  return {
    accountId: () => SOURCE,
    sequenceNumber: () => "100",
    incrementSequenceNumber: () => {},
    agentId: "agent-a",
  };
}

function makePipeline(signer: Signer, activityStore = new InMemoryActivityStore()): TransactionPipeline {
  return new TransactionPipeline({
    horizonUrl: TESTNET,
    networkPassphrase: PASSPHRASE,
    signer,
    activityStore,
    approvalStore: new InMemoryApprovalStore(),
  });
}

test("PIPELINE: abort mid-simulation rejects promptly with AbortError; no signing or submission", async (t) => {
  const signer = new RecordingSigner();
  const pipeline = makePipeline(signer);
  let submitCalled = false;
  (pipeline as any).simulator = new StellarSimulator(
    TESTNET,
    horizonServer({ fee: () => never<number>() })
  );
  (pipeline as any).submitter = {
    submit: async () => {
      submitCalled = true;
      return { hash: "x", ledger: 1 };
    },
  };

  const controller = new AbortController();
  const pending = pipeline.execute({
    intent: paymentIntent(),
    sourceAccount: fakeAccount(),
    signal: controller.signal,
  });
  abortAfter(controller);
  await expectAbortWithin(t, "pipeline mid-simulation", pending);
  assert.equal(signer.calls, 0, "no signing after a simulation abort");
  assert.equal(submitCalled, false, "no submission after a simulation abort");
});

test("PIPELINE: abort before submission starts does not reach submitTransaction", async () => {
  const signer = new RecordingSigner();
  const pipeline = makePipeline(signer);
  let submitCalls = 0;
  let observedSubmitCalls = 0;
  (pipeline as any).simulator = new StellarSimulator(TESTNET, horizonServer());
  (pipeline as any).submitter = {
    submit: async () => {
      submitCalls++;
      return { hash: "x", ledger: 1 };
    },
  };

  const controller = new AbortController();
  await assert.rejects(
    pipeline.execute({
      intent: paymentIntent(),
      sourceAccount: fakeAccount(),
      signal: controller.signal,
      onBeforeSubmit: () => {
        controller.abort();
        observedSubmitCalls = submitCalls;
      },
    }),
    (err: any) => err?.name === "AbortError"
  );
  assert.equal(signer.calls, 1, "signing completed before the abort");
  assert.equal(submitCalls, 0, "submission must not start after an abort");
  assert.equal(observedSubmitCalls, 0);
});

test("PIPELINE: abort mid-submission rejects promptly and records no submitted activity", async (t) => {
  const signer = new RecordingSigner();
  const activityStore = new InMemoryActivityStore();
  const pipeline = makePipeline(signer, activityStore);
  let submitCalls = 0;
  const server = {
    submitTransaction: () => {
      submitCalls++;
      return never();
    },
  } as unknown as Horizon.Server;
  (pipeline as any).simulator = new StellarSimulator(TESTNET, horizonServer());
  (pipeline as any).submitter = new StellarSubmitter(TESTNET, server);

  const controller = new AbortController();
  await withLiveSubmit(async () => {
    const pending = pipeline.execute({
      intent: paymentIntent(),
      sourceAccount: fakeAccount(),
      signal: controller.signal,
    });
    abortAfter(controller);
    await expectAbortWithin(t, "pipeline mid-submission", pending);
  });
  assert.equal(signer.calls, 1, "signing happens before submission");
  assert.equal(submitCalls, 1, "submission started before the abort");
  const activities = await activityStore.listAll(10);
  assert.equal(
    activities.filter((activity) => activity.status === "submitted").length,
    0,
    "a cancelled submission must never be recorded as submitted"
  );
});

test("PIPELINE: no-abort happy path is unchanged", async () => {
  const signer = new RecordingSigner();
  const pipeline = makePipeline(signer);
  (pipeline as any).simulator = new StellarSimulator(TESTNET, horizonServer());
  (pipeline as any).submitter = {
    submit: async () => ({ hash: "abc123", ledger: 7 }),
  };

  const outcome = await pipeline.execute({
    intent: paymentIntent(),
    sourceAccount: fakeAccount(),
  });
  assert.equal(outcome.status, "submitted");
  assert.equal(outcome.txHash, "abc123");
  assert.equal(signer.calls, 1);
});
