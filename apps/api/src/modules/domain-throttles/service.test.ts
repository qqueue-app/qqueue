import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { domainThrottleService } from "./service.js";

describe("domainThrottleService", () => {
  it("lists throttles for an organization ordered by domain", () => {
    prismaMock.domainThrottle.findMany.mockResolvedValue([] as never);
    domainThrottleService.list("org_1");
    expect(prismaMock.domainThrottle.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      orderBy: [{ domain: "asc" }]
    });
  });

  it("exposes the env default cap", () => {
    expect(domainThrottleService.defaultPerMinute()).toBe(60);
  });

  it("upserts on (organizationId, domain)", () => {
    prismaMock.domainThrottle.upsert.mockResolvedValue({} as never);
    domainThrottleService.upsert({
      organizationId: "org_1",
      domain: "gmail.com",
      maxPerMinute: 10
    });
    const call = prismaMock.domainThrottle.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      organizationId_domain: { organizationId: "org_1", domain: "gmail.com" }
    });
    expect(call.create).toMatchObject({ maxPerMinute: 10 });
    expect(call.update).toMatchObject({ maxPerMinute: 10 });
  });

  it("removes a throttle scoped by membership", async () => {
    prismaMock.domainThrottle.deleteMany.mockResolvedValue({ count: 1 } as never);
    await domainThrottleService.remove("t1", "user_1");
    expect(prismaMock.domainThrottle.deleteMany).toHaveBeenCalledWith({
      where: { id: "t1", organization: { members: { some: { userId: "user_1" } } } }
    });
  });

  it("throws 404 removing a throttle the user does not own", async () => {
    prismaMock.domainThrottle.deleteMany.mockResolvedValue({ count: 0 } as never);
    await expect(domainThrottleService.remove("t1", "user_1")).rejects.toThrow(
      "Domain throttle not found"
    );
  });
});
