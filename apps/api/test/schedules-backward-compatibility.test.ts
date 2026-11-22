import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import type { AddressInfo } from "node:net";
import { InMemoryScheduleStore, InMemoryAgentStore } from "@4evergent/database";
import type { ScheduleRecord } from "@4evergent/database";

// Regression test for issue #123: verify that the new global GET /schedules
// endpoint does not break existing agent-scoped schedule endpoints.

class MockSigner {
  getAccountId(): string {
    return "GTEST7777777777777777777777777777777777777777777777777777";
  }
  getNetworkPassphrase(): string {
    return "Test SDF Network ; September 2015";
  }
  async sign(transaction: any): Promise<any> {
    return transaction;
  }
}

const OWNER_A = "owner-a";

function makeSchedule(ownerId: string, agentId: string, index: number): ScheduleRecord {
  const now = new Date().toISOString();
  return {
    id: `schedule-${ownerId}-${agentId}-${index}`,
    agentId,
    ownerId,
    status: "active",
    intent: {
      type: "payment" as const,
      asset: "XLM",
      destination: "GDI73WJ4SX7LOG3XZDJC3KCK6ED6E5NBYK2JUBQSPBCNNWEG3ZN7T75U",
      amount: "10",
      reason: `test schedule ${index}`,
    },
    scheduleExpression: "*/5 * * * *",
    timezone: "UTC",
    nextRunAt: new Date(Date.now() + 1000 * 60 * 5).toISOString(),
    lastRunAt: null,
    lastStartedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function startServer() {
  const scheduleStore = new InMemoryScheduleStore();
  const agentStore = new InMemoryAgentStore();
  
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: new MockSigner(),
    scheduleStore,
    agentStore,
    authProvider: new DevAuthProvider({ defaultOwnerId: OWNER_A }),
  });

  await server.listen(0);
  const address = server.server.address() as AddressInfo;
  
  const registerAgent = (id: string, ownerId: string, displayName: string) => {
    server.registerAgent({
      id,
      displayName,
      description: "test agent",
      ownerId,
      stellarAddress: "GTEST",
      capabilities: ["payment"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      active: true,
      status: "active",
      metadata: {},
    });
    return { id, displayName, ownerId };
  };
  
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
    scheduleStore,
    agentStore,
    server,
    registerAgent,
  };
}

async function get(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

test("GET /agents/:id/schedules still works after adding global endpoint", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    
    await scheduleStore.create(makeSchedule(OWNER_A, agent.id, 1));
    await scheduleStore.create(makeSchedule(OWNER_A, agent.id, 2));

    const res = await get(baseUrl, `/agents/${agent.id}/schedules`);
    assert.equal(res.status, 200);
    assert.equal(res.body.agentId, agent.id);
    assert.equal(res.body.schedules.length, 2);
    assert.ok(typeof res.body.hasMore === "boolean");
  } finally {
    await close();
  }
});

test("GET /agents/:id/schedules/:scheduleId still works", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    const schedule = await scheduleStore.create(makeSchedule(OWNER_A, agent.id, 1));

    const res = await get(baseUrl, `/agents/${agent.id}/schedules/${schedule.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.schedule.id, schedule.id);
    assert.equal(res.body.schedule.agentId, agent.id);
  } finally {
    await close();
  }
});

test("Agent-scoped endpoint filters by agent, global endpoint returns all agents", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent1 = await registerAgent("agent-1", OWNER_A, "Agent 1");
    const agent2 = await registerAgent("agent-2", OWNER_A, "Agent 2");
    
    await scheduleStore.create(makeSchedule(OWNER_A, agent1.id, 1));
    await scheduleStore.create(makeSchedule(OWNER_A, agent1.id, 2));
    await scheduleStore.create(makeSchedule(OWNER_A, agent2.id, 1));

    // Agent-scoped endpoint returns only agent1's schedules
    const resAgent = await get(baseUrl, `/agents/${agent1.id}/schedules`);
    assert.equal(resAgent.status, 200);
    assert.equal(resAgent.body.schedules.length, 2);
    for (const schedule of resAgent.body.schedules) {
      assert.equal(schedule.agentId, agent1.id);
    }

    // Global endpoint returns all schedules
    const resGlobal = await get(baseUrl, "/schedules");
    assert.equal(resGlobal.status, 200);
    assert.equal(resGlobal.body.schedules.length, 3);
    
    const agentIds = new Set(resGlobal.body.schedules.map((s: any) => s.agentId));
    assert.equal(agentIds.size, 2);
    assert.ok(agentIds.has(agent1.id));
    assert.ok(agentIds.has(agent2.id));
  } finally {
    await close();
  }
});

test("Global endpoint does not interfere with agent-scoped routing", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    await scheduleStore.create(makeSchedule(OWNER_A, agent.id, 1));

    // Both endpoints should work without interfering
    const resAgent = await get(baseUrl, `/agents/${agent.id}/schedules`);
    assert.equal(resAgent.status, 200);
    assert.equal(resAgent.body.agentId, agent.id);

    const resGlobal = await get(baseUrl, "/schedules");
    assert.equal(resGlobal.status, 200);
    assert.ok(Array.isArray(resGlobal.body.schedules));
  } finally {
    await close();
  }
});

test("Agent-scoped response format unchanged", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    await scheduleStore.create(makeSchedule(OWNER_A, agent.id, 1));

    const res = await get(baseUrl, `/agents/${agent.id}/schedules`);
    assert.equal(res.status, 200);
    
    // Verify existing response structure
    assert.ok(res.body.agentId);
    assert.ok(Array.isArray(res.body.schedules));
    assert.ok(typeof res.body.hasMore === "boolean");
    
    // Verify schedule structure
    const schedule = res.body.schedules[0];
    assert.ok(schedule.id);
    assert.ok(schedule.agentId);
    assert.ok(schedule.ownerId);
    assert.ok(schedule.intent);
    assert.ok(schedule.scheduleExpression);
  } finally {
    await close();
  }
});
