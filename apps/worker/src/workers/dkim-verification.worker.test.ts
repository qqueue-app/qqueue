import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  let processor:
    | ((job: { data: { sendingDomainId?: string } }) => Promise<unknown>)
    | undefined;
  return {
    getProcessor: () => processor,
    setProcessor: (p: typeof processor) => {
      processor = p;
    },
    verifySendingDomain: vi.fn(),
    verifyAllManagedDomains: vi.fn()
  };
});

vi.mock("bullmq", () => ({
  Worker: vi.fn((_name: string, p: never) => {
    h.setProcessor(p);
    return { name: _name };
  })
}));
vi.mock("../config/redis.js", () => ({ redisConnection: {} }));
vi.mock("../lib/dkim-verify.js", () => ({
  verifySendingDomain: h.verifySendingDomain,
  verifyAllManagedDomains: h.verifyAllManagedDomains
}));

import { startDkimVerificationWorker } from "./dkim-verification.worker.js";

function run(data: { sendingDomainId?: string }) {
  startDkimVerificationWorker();
  const processor = h.getProcessor();
  if (!processor) {
    throw new Error("processor not captured");
  }
  return processor({ data });
}

beforeEach(() => {
  h.verifySendingDomain.mockReset();
  h.verifyAllManagedDomains.mockReset();
});

describe("dkim-verification worker", () => {
  it("starts a Worker for the dkim-verification queue", () => {
    expect(startDkimVerificationWorker()).toMatchObject({
      name: "dkim-verification"
    });
  });

  it("verifies a single domain when an id is provided", async () => {
    await run({ sendingDomainId: "d1" });
    expect(h.verifySendingDomain).toHaveBeenCalledWith("d1");
    expect(h.verifyAllManagedDomains).not.toHaveBeenCalled();
  });

  it("rechecks all managed domains when no id is provided", async () => {
    await run({});
    expect(h.verifyAllManagedDomains).toHaveBeenCalledOnce();
    expect(h.verifySendingDomain).not.toHaveBeenCalled();
  });
});
