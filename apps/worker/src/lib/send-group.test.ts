import { describe, expect, it } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { settleSendGroup } from "./send-group.js";

describe("logical send presentation", () => {
  it("leaves ungrouped jobs alone", async () => {
    await settleSendGroup("org1", null);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    [["SENT", "QUEUED"], "QUEUED"],
    [["SENT", "PROCESSING"], "PROCESSING"],
    [["SENT", "UNCERTAIN"], "UNCERTAIN"],
    [["SENT", "FAILED"], "SENT"],
    [["SUPPRESSED", "FAILED"], "FAILED"],
    [["CANCELLED"], "CANCELLED"],
    [["SUPPRESSED"], "SUPPRESSED"],
  ])(
    "folds %j into %s without changing delivery outcomes",
    async (statuses, expected) => {
      prismaMock.emailJob.findMany.mockResolvedValue(
        statuses.map((status) => ({ status })) as never
      );
      await settleSendGroup("org1", "g1");
      expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org1",
          sendGroupId: "g1",
          groupPrimary: true,
        },
        data: { groupStatus: expected },
      });
    }
  );
  it("ignores groups removed before reconciliation", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([]);
    await settleSendGroup("org1", "g1");
    expect(prismaMock.emailJob.updateMany).not.toHaveBeenCalled();
  });
});
