import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Thin adapter: these tests pin the HTTP contract (envelope, which args reach
// the service) without re-testing service behaviour.
vi.mock("./service.js", () => ({
  sentService: { list: vi.fn() }
}));

const { sentController } = await import("./controller.js");
const { sentService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

const emptyPage = { rows: [], total: 0, page: 1, pageSize: 25 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sentService.list).mockResolvedValue(emptyPage as never);
});

describe("sentController.list", () => {
  it("lists with the defaults when nothing is filtered", async () => {
    const res = mockRes();

    await sentController.list(
      { query: {}, organizationId: "org_1", userId: "usr_1" } as unknown as Request,
      res
    );

    expect(sentService.list).toHaveBeenCalledWith(
      {
        organizationId: "org_1",
        origin: "all",
        outcome: "all",
        days: 0,
        page: 1,
        pageSize: 25
      },
      "usr_1"
    );
    expect(res.json).toHaveBeenCalledWith({ data: emptyPage });
  });

  it("passes the filters through, coercing the numeric ones", async () => {
    const res = mockRes();

    await sentController.list(
      {
        query: {
          q: " launch ",
          origin: "CAMPAIGN",
          outcome: "opened",
          smtpConnectionId: "smtp_1",
          days: "30",
          page: "2",
          pageSize: "50"
        },
        organizationId: "org_1",
        userId: "usr_1"
      } as unknown as Request,
      res
    );

    expect(sentService.list).toHaveBeenCalledWith(
      {
        organizationId: "org_1",
        q: "launch",
        origin: "CAMPAIGN",
        outcome: "opened",
        smtpConnectionId: "smtp_1",
        days: 30,
        page: 2,
        pageSize: 50
      },
      "usr_1"
    );
  });

  it("reads the org from the membership middleware, not the query string", async () => {
    const res = mockRes();

    await sentController.list(
      {
        query: { organizationId: "org_someone_else" },
        organizationId: "org_1",
        userId: "usr_1"
      } as unknown as Request,
      res
    );

    expect(sentService.list).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" }),
      "usr_1"
    );
  });

  it("rejects an outcome the pipeline can't answer", async () => {
    const res = mockRes();

    await expect(
      sentController.list(
        {
          query: { outcome: "read-twice" },
          organizationId: "org_1"
        } as unknown as Request,
        res
      )
    ).rejects.toThrow();
    expect(sentService.list).not.toHaveBeenCalled();
  });
});
