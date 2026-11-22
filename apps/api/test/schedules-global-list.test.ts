import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import type { AddressInfo } from "node:net";
import { InMemoryScheduleStore, InMemoryAgentStore } from "@4evergent/database";
import type { ScheduleRecord } from "@4evergent/database";

// Offline test: in-process HTTP server + in-memory stores. No network access.
// Tests for issue #123 — global GET /schedules endpoint with owner isolation.

class MockSigner {
  getAccountId(): string {
    return "GTEST7777777777777777777777777777777777777777777777777777";
  }
  getNetworkPassphrase(): string {
    return "Test SDF Network ; September 2015";
  }
  async sign(transaction: any): Promise<any> {
    transaction.signatures = [{ hint: Buffer.from("mock"), signature: Buffer.from("sig") }];
    return transaction;
  }
}

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";

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
    authProvider: new DevAuthProvider({
      defaultOwnerId: OWNER_A,
      apiKeys: {
        "owner-b-token": OWNER_B,
      },
    }),
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

async function get(baseUrl: string, path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

test("GET /schedules returns 401 when unauthenticated", async () => {
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: new MockSigner(),
    authProvider: new DevAuthProvider({
      defaultOwnerId: undefined, // Forces authentication requirement
    }),
  });

  await server.listen(0);
  const address = server.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const res = await fetch(`${baseUrl}/schedules`);
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.code, "UNAUTHORIZED");
  } finally {
    await server.close();
  }
});

test("GET /schedules returns empty array when owner has no schedules", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await get(baseUrl, "/schedules");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.schedules, []);
    assert.equal(res.body.hasMore, false);
  } finally {
    await close();
  }
});

test("GET /schedules returns schedules only for authenticated owner", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    // Create agents for both owners
    const agentA1 = registerAgent("agent-a1", OWNER_A, "Agent A1");
    const agentA2 = registerAgent("agent-a2", OWNER_A, "Agent A2");
    const agentB1 = registerAgent("agent-b1", OWNER_B, "Agent B1");

    // Create schedules for owner A
    await scheduleStore.create(makeSchedule(OWNER_A, agentA1.id, 1));
    await scheduleStore.create(makeSchedule(OWNER_A, agentA1.id, 2));
    await scheduleStore.create(makeSchedule(OWNER_A, agentA2.id, 3));

    // Create schedules for owner B
    await scheduleStore.create(makeSchedule(OWNER_B, agentB1.id, 1));
    await scheduleStore.create(makeSchedule(OWNER_B, agentB1.id, 2));

    // Request as owner A (default)
    const resA = await get(baseUrl, "/schedules");
    assert.equal(resA.status, 200);
    assert.equal(resA.body.schedules.length, 3);
    
    // Verify all returned schedules belong to owner A
    for (const schedule of resA.body.schedules) {
      assert.equal(schedule.ownerId, OWNER_A);
      assert.ok([agentA1.id, agentA2.id].includes(schedule.agentId));
    }
    
    // Verify no owner B schedules are returned
    const ownerBIds = resA.body.schedules.map((s: any) => s.agentId);
    assert.ok(!ownerBIds.includes(agentB1.id));

    // Request as owner B
    const resB = await get(baseUrl, "/schedules", "owner-b-token");
    assert.equal(resB.status, 200);
    assert.equal(resB.body.schedules.length, 2);
    
    // Verify all returned schedules belong to owner B
    for (const schedule of resB.body.schedules) {
      assert.equal(schedule.ownerId, OWNER_B);
      assert.equal(schedule.agentId, agentB1.id);
    }
  } finally {
    await close();
  }
});

test("GET /schedules includes agent information in each schedule", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    await scheduleStore.create(makeSchedule(OWNER_A, agent.id, 1));

    const res = await get(baseUrl, "/schedules");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 1);
    
    const schedule = res.body.schedules[0];
    assert.equal(schedule.agentId, agent.id);
    assert.equal(schedule.ownerId, OWNER_A);
    assert.ok(schedule.id);
    assert.ok(schedule.intent);
    assert.ok(schedule.scheduleExpression);
  } finally {
    await close();
  }
});

test("GET /schedules respects default limit of 50", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    
    // Create 60 schedules
    for (let i = 0; i < 60; i++) {
      await scheduleStore.create(makeSchedule(OWNER_A, agent.id, i));
    }

    const res = await get(baseUrl, "/schedules");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 50);
    assert.equal(res.body.hasMore, true);
  } finally {
    await close();
  }
});

test("GET /schedules respects custom limit parameter", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    
    // Create 30 schedules
    for (let i = 0; i < 30; i++) {
      await scheduleStore.create(makeSchedule(OWNER_A, agent.id, i));
    }

    const res = await get(baseUrl, "/schedules?limit=10");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 10);
    assert.equal(res.body.hasMore, true);
  } finally {
    await close();
  }
});

test("GET /schedules clamps limit to maximum of 100", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    
    // Create 120 schedules
    for (let i = 0; i < 120; i++) {
      await scheduleStore.create(makeSchedule(OWNER_A, agent.id, i));
    }

    const res = await get(baseUrl, "/schedules?limit=500");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 100);
    assert.equal(res.body.hasMore, true);
  } finally {
    await close();
  }
});

test("GET /schedules clamps limit to minimum of 1", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    await scheduleStore.create(makeSchedule(OWNER_A, agent.id, 1));

    const res = await get(baseUrl, "/schedules?limit=0");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 1);
  } finally {
    await close();
  }
});

test("GET /schedules supports offset pagination", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    
    // Create 15 schedules
    for (let i = 0; i < 15; i++) {
      await scheduleStore.create(makeSchedule(OWNER_A, agent.id, i));
    }

    // Get first page
    const res1 = await get(baseUrl, "/schedules?limit=10&offset=0");
    assert.equal(res1.status, 200);
    assert.equal(res1.body.schedules.length, 10);
    assert.equal(res1.body.hasMore, true);

    // Get second page
    const res2 = await get(baseUrl, "/schedules?limit=10&offset=10");
    assert.equal(res2.status, 200);
    assert.equal(res2.body.schedules.length, 5);
    assert.equal(res2.body.hasMore, false);
  } finally {
    await close();
  }
});

test("GET /schedules hasMore is false on last page", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    
    // Create exactly 10 schedules
    for (let i = 0; i < 10; i++) {
      await scheduleStore.create(makeSchedule(OWNER_A, agent.id, i));
    }

    const res = await get(baseUrl, "/schedules?limit=10");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 10);
    assert.equal(res.body.hasMore, false);
  } finally {
    await close();
  }
});

test("GET /schedules handles invalid limit gracefully", async () => {
  const { baseUrl, close } = await startServer();
  try {
    // Invalid limits should be treated as default
    const res = await get(baseUrl, "/schedules?limit=abc");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.schedules));
  } finally {
    await close();
  }
});

test("GET /schedules handles invalid offset gracefully", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent = await registerAgent("test-agent", OWNER_A, "Test Agent");
    await scheduleStore.create(makeSchedule(OWNER_A, agent.id, 1));

    // Invalid offset should be treated as 0
    const res = await get(baseUrl, "/schedules?offset=abc");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 1);
  } finally {
    await close();
  }
});

test("GET /schedules returns schedules across multiple agents for the same owner", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agent1 = await registerAgent("agent-1", OWNER_A, "Agent 1");
    const agent2 = await registerAgent("agent-2", OWNER_A, "Agent 2");
    const agent3 = await registerAgent("agent-3", OWNER_A, "Agent 3");

    await scheduleStore.create(makeSchedule(OWNER_A, agent1.id, 1));
    await scheduleStore.create(makeSchedule(OWNER_A, agent1.id, 2));
    await scheduleStore.create(makeSchedule(OWNER_A, agent2.id, 1));
    await scheduleStore.create(makeSchedule(OWNER_A, agent3.id, 1));
    await scheduleStore.create(makeSchedule(OWNER_A, agent3.id, 2));

    const res = await get(baseUrl, "/schedules");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 5);
    
    // Verify all belong to owner A
    for (const schedule of res.body.schedules) {
      assert.equal(schedule.ownerId, OWNER_A);
    }
    
    // Verify we have schedules from all three agents
    const agentIds = new Set(res.body.schedules.map((s: any) => s.agentId));
    assert.equal(agentIds.size, 3);
    assert.ok(agentIds.has(agent1.id));
    assert.ok(agentIds.has(agent2.id));
    assert.ok(agentIds.has(agent3.id));
  } finally {
    await close();
  }
});

test("GET /schedules does not expose another owner's schedules even with high limit", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agentA = await registerAgent("agent-a", OWNER_A, "Agent A");
    const agentB = await registerAgent("agent-b", OWNER_B, "Agent B");

    // Create many schedules for both owners
    for (let i = 0; i < 50; i++) {
      await scheduleStore.create(makeSchedule(OWNER_A, agentA.id, i));
    }
    for (let i = 0; i < 50; i++) {
      await scheduleStore.create(makeSchedule(OWNER_B, agentB.id, i));
    }

    // Request as owner A with high limit
    const res = await get(baseUrl, "/schedules?limit=100");
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.length, 50);
    
    // Verify NONE belong to owner B
    for (const schedule of res.body.schedules) {
      assert.equal(schedule.ownerId, OWNER_A);
      assert.notEqual(schedule.ownerId, OWNER_B);
    }
  } finally {
    await close();
  }
});

test("GET /schedules owner isolation: owner with no schedules gets empty array even when other owners have many", async () => {
  const { baseUrl, close, scheduleStore, registerAgent } = await startServer();
  try {
    const agentB = await registerAgent("agent-b", OWNER_B, "Agent B");

    // Create many schedules for owner B only
    for (let i = 0; i < 100; i++) {
      await scheduleStore.create(makeSchedule(OWNER_B, agentB.id, i));
    }

    // Request as owner A (who has no schedules)
    const res = await get(baseUrl, "/schedules");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.schedules, []);
    assert.equal(res.body.hasMore, false);
  } finally {
    await close();
  }
});
