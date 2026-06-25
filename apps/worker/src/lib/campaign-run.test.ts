import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { settleRunIfComplete } from "./campaign-run.js";

const FIXED_NEXT = new Date("2026-02-01T00:00:00.000Z");

vi.mock("@qqueue/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@qqueue/shared")>()),
  nextCronRun: vi.fn(() => FIXED_NEXT)
}));

describe("settleRunIfComplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
  });

  it("does nothing when campaignRunId is null", async () => {
    await settleRunIfComplete(null);
    expect(prismaMock.emailJob.count).not.toHaveBeenCalled();
  });

  it("returns early while active jobs remain", async () => {
    prismaMock.emailJob.count.mockResolvedValue(3 as never);
    await settleRunIfComplete("run_1");
    expect(prismaMock.campaignRun.findUnique).not.toHaveBeenCalled();
  });

  it("returns when the run is missing", async () => {
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.campaignRun.findUnique.mockResolvedValue(null as never);
    await settleRunIfComplete("run_1");
    expect(prismaMock.campaignRun.update).not.toHaveBeenCalled();
  });

  it("returns when the run is not in SENDING state", async () => {
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.campaignRun.findUnique.mockResolvedValue({
      id: "run_1",
      campaignId: "camp_1",
      status: "SENT"
    } as never);
    await settleRunIfComplete("run_1");
    expect(prismaMock.campaignRun.update).not.toHaveBeenCalled();
  });

  it("marks the run SENT then returns when the campaign is missing", async () => {
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.campaignRun.findUnique.mockResolvedValue({
      id: "run_1",
      campaignId: "camp_1",
      status: "SENDING"
    } as never);
    prismaMock.campaign.findUnique.mockResolvedValue(null as never);

    await settleRunIfComplete("run_1");

    expect(prismaMock.campaignRun.update).toHaveBeenCalledWith({
      where: { id: "run_1" },
      data: { status: "SENT", completedAt: new Date() }
    });
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("does not touch a campaign that is no longer SENDING", async () => {
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.campaignRun.findUnique.mockResolvedValue({
      id: "run_1",
      campaignId: "camp_1",
      status: "SENDING"
    } as never);
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "camp_1",
      status: "PAUSED",
      cronExpression: null,
      timezone: null
    } as never);

    await settleRunIfComplete("run_1");

    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("returns a recurring campaign to SCHEDULED with the next run time", async () => {
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.campaignRun.findUnique.mockResolvedValue({
      id: "run_1",
      campaignId: "camp_1",
      status: "SENDING"
    } as never);
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "camp_1",
      status: "SENDING",
      cronExpression: "0 0 * * *",
      timezone: "UTC"
    } as never);

    await settleRunIfComplete("run_1");

    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: {
        status: "SCHEDULED",
        lastRunAt: new Date(),
        nextRunAt: FIXED_NEXT
      }
    });
  });

  it("marks a one-shot campaign SENT", async () => {
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.campaignRun.findUnique.mockResolvedValue({
      id: "run_1",
      campaignId: "camp_1",
      status: "SENDING"
    } as never);
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "camp_1",
      status: "SENDING",
      cronExpression: null,
      timezone: null
    } as never);

    await settleRunIfComplete("run_1");

    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { status: "SENT", lastRunAt: new Date() }
    });
  });
});
