import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { unsubscribeService } from "./service.js";

describe("unsubscribeService.unsubscribe", () => {
  it("suppresses the address (UNSUBSCRIBE) and flips the contact to UNSUBSCRIBED", async () => {
    prismaMock.suppression.upsert.mockResolvedValue({ id: "s1" } as never);
    prismaMock.contact.updateMany.mockResolvedValue({ count: 1 } as never);

    await unsubscribeService.unsubscribe("org_1", "u@x.com");

    expect(prismaMock.suppression.upsert.mock.calls[0][0].create).toMatchObject({
      organizationId: "org_1",
      email: "u@x.com",
      reason: "UNSUBSCRIBE"
    });
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", email: "u@x.com" },
      data: { status: "UNSUBSCRIBED" }
    });
  });
});
