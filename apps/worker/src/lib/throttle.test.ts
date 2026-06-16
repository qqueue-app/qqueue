import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const h = vi.hoisted(() => ({
  incr: vi.fn(),
  pexpire: vi.fn()
}));

vi.mock("ioredis", () => ({
  Redis: vi.fn(() => ({ incr: h.incr, pexpire: h.pexpire }))
}));

import { recipientDomain, reserveDomainSlot, resolveCap } from "./throttle.js";

beforeEach(() => {
  h.incr.mockReset();
  h.pexpire.mockReset();
});

describe("recipientDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(recipientDomain("Person@Gmail.com")).toBe("gmail.com");
    expect(recipientDomain("a.b+tag@sub.example.co.uk")).toBe(
      "sub.example.co.uk"
    );
  });

  it("returns null for an address with no usable domain", () => {
    expect(recipientDomain("no-at-sign")).toBeNull();
    expect(recipientDomain("trailing@")).toBeNull();
  });
});

describe("resolveCap", () => {
  const rows = [
    { domain: "", maxPerMinute: 30 },
    { domain: "gmail.com", maxPerMinute: 5 }
  ];

  it("prefers an exact domain row", () => {
    expect(resolveCap(rows, "gmail.com", 60)).toBe(5);
  });

  it("falls back to the org default row", () => {
    expect(resolveCap(rows, "yahoo.com", 60)).toBe(30);
  });

  it("falls back to the env default when no rows match", () => {
    expect(resolveCap([], "yahoo.com", 60)).toBe(60);
  });
});

describe("reserveDomainSlot", () => {
  it("allows a send under the cap and sets the window TTL on the first hit", async () => {
    prismaMock.domainThrottle.findMany.mockResolvedValue([] as never);
    h.incr.mockResolvedValue(1 as never);
    const decision = await reserveDomainSlot("org1", "x@gmail.com");
    expect(decision.allowed).toBe(true);
    expect(h.pexpire).toHaveBeenCalledOnce();
  });

  it("denies a send over the cap and returns a retry delay", async () => {
    prismaMock.domainThrottle.findMany.mockResolvedValue([
      { domain: "gmail.com", maxPerMinute: 2 }
    ] as never);
    h.incr.mockResolvedValue(3 as never);
    const decision = await reserveDomainSlot("org1", "x@gmail.com");
    expect(decision.allowed).toBe(false);
    expect(decision.retryInMs ?? 0).toBeGreaterThan(0);
    expect(decision.retryInMs ?? 0).toBeLessThanOrEqual(60_001);
  });

  it("never throttles an address without a parseable domain", async () => {
    const decision = await reserveDomainSlot("org1", "no-domain");
    expect(decision.allowed).toBe(true);
    expect(h.incr).not.toHaveBeenCalled();
  });
});
