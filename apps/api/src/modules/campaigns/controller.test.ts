import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
//
// Fan-out, suppression filtering and queueing all live behind these service
// methods — the controller never enqueues or sends directly.
vi.mock("./service.js", () => ({
  campaignService: {
    list: vi.fn(),
    get: vi.fn(),
    analytics: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    configureAbTest: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    sendNow: vi.fn(),
    schedule: vi.fn(),
    setRecurrence: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  }
}));

const { campaignController } = await import("./controller.js");
const { campaignService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("campaignController.list", () => {
  it("lists campaigns for the org pinned by requireOrgMembership", async () => {
    const rows = [{ id: "cmp_1" }];
    vi.mocked(campaignService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await campaignController.list({ organizationId: "org_1" } as Request, res);

    expect(campaignService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("campaignController.get", () => {
  it("returns the campaign scoped to the requesting user", async () => {
    const row = { id: "cmp_1" };
    vi.mocked(campaignService.get).mockResolvedValue(row as never);
    const res = mockRes();

    await campaignController.get(
      { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(campaignService.get).toHaveBeenCalledWith("cmp_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: row });
  });

  it("responds 404 when the campaign is not visible to the user", async () => {
    vi.mocked(campaignService.get).mockResolvedValue(null as never);
    const res = mockRes();

    await campaignController.get(
      { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Campaign not found" }
    });
  });
});

describe("campaignController.analytics", () => {
  it("returns analytics for the campaign", async () => {
    const analytics = { sent: 10, opened: 4, variants: [] };
    vi.mocked(campaignService.analytics).mockResolvedValue(analytics as never);
    const res = mockRes();

    await campaignController.analytics(
      { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(campaignService.analytics).toHaveBeenCalledWith("cmp_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: analytics });
  });
});

describe("campaignController.create", () => {
  it("creates a contact-list campaign and responds 201", async () => {
    const created = { id: "cmp_1" };
    vi.mocked(campaignService.create).mockResolvedValue(created as never);
    const res = mockRes();

    await campaignController.create(
      {
        body: {
          organizationId: "org_1",
          name: "Launch",
          templateId: "tpl_1",
          contactListId: "lst_1"
        }
      } as Request,
      res
    );

    expect(campaignService.create).toHaveBeenCalledWith({
      organizationId: "org_1",
      name: "Launch",
      templateId: "tpl_1",
      contactListId: "lst_1"
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("creates a segment-targeted campaign", async () => {
    vi.mocked(campaignService.create).mockResolvedValue({} as never);

    await campaignController.create(
      {
        body: { organizationId: "org_1", name: "Dynamic", segmentId: "seg_1" }
      } as Request,
      mockRes()
    );

    expect(campaignService.create).toHaveBeenCalledWith(
      expect.objectContaining({ segmentId: "seg_1" })
    );
  });

  it("rejects a campaign targeting both a list and a segment", async () => {
    // A campaign targets a static contact list OR a dynamic segment, never both.
    await expect(
      campaignController.create(
        {
          body: {
            organizationId: "org_1",
            name: "Both",
            contactListId: "lst_1",
            segmentId: "seg_1"
          }
        } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.create).not.toHaveBeenCalled();
  });

  it("rejects a campaign with no name", async () => {
    await expect(
      campaignController.create(
        { body: { organizationId: "org_1" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.create).not.toHaveBeenCalled();
  });
});

describe("campaignController.update", () => {
  it("updates the campaign with the validated patch", async () => {
    const updated = { id: "cmp_1", name: "Renamed" };
    vi.mocked(campaignService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await campaignController.update(
      {
        params: { id: "cmp_1" },
        userId: "usr_1",
        body: { name: "Renamed" }
      } as unknown as Request,
      res
    );

    expect(campaignService.update).toHaveBeenCalledWith("cmp_1", "usr_1", {
      name: "Renamed"
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an update that sets both a list and a segment", async () => {
    await expect(
      campaignController.update(
        {
          params: { id: "cmp_1" },
          userId: "usr_1",
          body: { contactListId: "lst_1", segmentId: "seg_1" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.update).not.toHaveBeenCalled();
  });
});

describe("campaignController.configureAbTest", () => {
  it("configures an enabled A/B subject test with variants", async () => {
    const campaign = { id: "cmp_1", abTestEnabled: true };
    vi.mocked(campaignService.configureAbTest).mockResolvedValue(campaign as never);
    const res = mockRes();

    await campaignController.configureAbTest(
      {
        params: { id: "cmp_1" },
        userId: "usr_1",
        body: {
          enabled: true,
          percent: 20,
          metric: "OPEN",
          windowMin: 60,
          variants: [
            { label: "A", subject: "First subject" },
            { label: "B", subject: "Second subject" }
          ]
        }
      } as unknown as Request,
      res
    );

    expect(campaignService.configureAbTest).toHaveBeenCalledWith(
      "cmp_1",
      "usr_1",
      expect.objectContaining({ enabled: true, percent: 20, metric: "OPEN" })
    );
    expect(res.json).toHaveBeenCalledWith({ data: campaign });
  });

  it("disables an A/B test without requiring the other fields", async () => {
    vi.mocked(campaignService.configureAbTest).mockResolvedValue({} as never);

    await campaignController.configureAbTest(
      {
        params: { id: "cmp_1" },
        userId: "usr_1",
        body: { enabled: false }
      } as unknown as Request,
      mockRes()
    );

    expect(campaignService.configureAbTest).toHaveBeenCalledWith("cmp_1", "usr_1", {
      enabled: false
    });
  });

  it("rejects an enabled A/B test missing percent/metric/windowMin", async () => {
    await expect(
      campaignController.configureAbTest(
        {
          params: { id: "cmp_1" },
          userId: "usr_1",
          body: {
            enabled: true,
            variants: [
              { label: "A", subject: "One" },
              { label: "B", subject: "Two" }
            ]
          }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.configureAbTest).not.toHaveBeenCalled();
  });

  it("rejects an enabled A/B test with fewer than two variants", async () => {
    await expect(
      campaignController.configureAbTest(
        {
          params: { id: "cmp_1" },
          userId: "usr_1",
          body: {
            enabled: true,
            percent: 10,
            metric: "CLICK",
            windowMin: 30,
            variants: [{ label: "A", subject: "Only one" }]
          }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.configureAbTest).not.toHaveBeenCalled();
  });

  it("rejects a test percent above the 50% ceiling", async () => {
    await expect(
      campaignController.configureAbTest(
        {
          params: { id: "cmp_1" },
          userId: "usr_1",
          body: {
            enabled: true,
            percent: 80,
            metric: "OPEN",
            windowMin: 60,
            variants: [
              { label: "A", subject: "One" },
              { label: "B", subject: "Two" }
            ]
          }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.configureAbTest).not.toHaveBeenCalled();
  });
});

describe("campaignController.duplicate", () => {
  it("duplicates the campaign and responds 201", async () => {
    const copy = { id: "cmp_2" };
    vi.mocked(campaignService.duplicate).mockResolvedValue(copy as never);
    const res = mockRes();

    await campaignController.duplicate(
      { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(campaignService.duplicate).toHaveBeenCalledWith("cmp_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: copy });
  });
});

describe("campaignController.delete", () => {
  it("deletes by id and responds 204 with no body", async () => {
    vi.mocked(campaignService.delete).mockResolvedValue(undefined as never);
    const res = mockRes();

    await campaignController.delete(
      { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(campaignService.delete).toHaveBeenCalledWith("cmp_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("campaignController.sendNow", () => {
  it("hands the send off to the service and returns the campaign", async () => {
    const campaign = { id: "cmp_1", status: "SENDING" };
    vi.mocked(campaignService.sendNow).mockResolvedValue(campaign as never);
    const res = mockRes();

    await campaignController.sendNow(
      { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(campaignService.sendNow).toHaveBeenCalledWith("cmp_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: campaign });
  });

  it("propagates a service rejection (e.g. an unsendable campaign)", async () => {
    vi.mocked(campaignService.sendNow).mockRejectedValue(
      new Error("Campaign has no recipients")
    );

    await expect(
      campaignController.sendNow(
        { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Campaign has no recipients");
  });
});

describe("campaignController.schedule", () => {
  it("schedules a one-shot send at the validated ISO datetime", async () => {
    const campaign = { id: "cmp_1", status: "SCHEDULED" };
    vi.mocked(campaignService.schedule).mockResolvedValue(campaign as never);
    const res = mockRes();

    await campaignController.schedule(
      {
        params: { id: "cmp_1" },
        userId: "usr_1",
        body: { scheduledAt: "2026-08-01T09:00:00.000Z" }
      } as unknown as Request,
      res
    );

    expect(campaignService.schedule).toHaveBeenCalledWith("cmp_1", "usr_1", {
      scheduledAt: "2026-08-01T09:00:00.000Z"
    });
    expect(res.json).toHaveBeenCalledWith({ data: campaign });
  });

  it("rejects a non-datetime scheduledAt", async () => {
    await expect(
      campaignController.schedule(
        {
          params: { id: "cmp_1" },
          userId: "usr_1",
          body: { scheduledAt: "next tuesday" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.schedule).not.toHaveBeenCalled();
  });
});

describe("campaignController.setRecurrence", () => {
  it("sets a cron recurrence with a timezone", async () => {
    const campaign = { id: "cmp_1", cronExpression: "0 9 * * 1" };
    vi.mocked(campaignService.setRecurrence).mockResolvedValue(campaign as never);
    const res = mockRes();

    await campaignController.setRecurrence(
      {
        params: { id: "cmp_1" },
        userId: "usr_1",
        body: { cronExpression: "0 9 * * 1", timezone: "Europe/London" }
      } as unknown as Request,
      res
    );

    expect(campaignService.setRecurrence).toHaveBeenCalledWith("cmp_1", "usr_1", {
      cronExpression: "0 9 * * 1",
      timezone: "Europe/London"
    });
    expect(res.json).toHaveBeenCalledWith({ data: campaign });
  });

  it("rejects an invalid cron expression", async () => {
    await expect(
      campaignController.setRecurrence(
        {
          params: { id: "cmp_1" },
          userId: "usr_1",
          body: { cronExpression: "not a cron", timezone: "UTC" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.setRecurrence).not.toHaveBeenCalled();
  });

  it("rejects an invalid timezone", async () => {
    await expect(
      campaignController.setRecurrence(
        {
          params: { id: "cmp_1" },
          userId: "usr_1",
          body: { cronExpression: "0 9 * * 1", timezone: "Mars/Olympus" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(campaignService.setRecurrence).not.toHaveBeenCalled();
  });
});

describe("campaignController.pause", () => {
  it("pauses the campaign and returns its new state", async () => {
    const campaign = { id: "cmp_1", status: "PAUSED" };
    vi.mocked(campaignService.pause).mockResolvedValue(campaign as never);
    const res = mockRes();

    await campaignController.pause(
      { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(campaignService.pause).toHaveBeenCalledWith("cmp_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: campaign });
  });

  it("propagates a service rejection when the campaign is not pausable", async () => {
    vi.mocked(campaignService.pause).mockRejectedValue(
      new Error("Campaign is not running")
    );

    await expect(
      campaignController.pause(
        { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Campaign is not running");
  });
});

describe("campaignController.resume", () => {
  it("resumes the campaign and returns its new state", async () => {
    const campaign = { id: "cmp_1", status: "SCHEDULED" };
    vi.mocked(campaignService.resume).mockResolvedValue(campaign as never);
    const res = mockRes();

    await campaignController.resume(
      { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(campaignService.resume).toHaveBeenCalledWith("cmp_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: campaign });
  });

  it("propagates a service rejection when the campaign is not paused", async () => {
    vi.mocked(campaignService.resume).mockRejectedValue(
      new Error("Campaign is not paused")
    );

    await expect(
      campaignController.resume(
        { params: { id: "cmp_1" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Campaign is not paused");
  });
});
