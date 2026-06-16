import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const add = vi.fn();
const upsertJobScheduler = vi.fn();
const removeJobScheduler = vi.fn();

vi.mock("../../queues/campaign-processing.queue.js", () => ({
  campaignProcessingQueue: { add, upsertJobScheduler, removeJobScheduler }
}));

const { campaignService } = await import("./service.js");

beforeEach(() => {
  add.mockReset().mockResolvedValue(undefined);
  upsertJobScheduler.mockReset().mockResolvedValue(undefined);
  removeJobScheduler.mockReset().mockResolvedValue(undefined);
  // Most campaigns have no A/B variants; analytics defaults to an empty set.
  prismaMock.campaignVariant.findMany.mockResolvedValue([] as never);
});

afterEach(() => {
  vi.useRealTimers();
});

const draft = {
  id: "c1",
  organizationId: "org_1",
  name: "Camp",
  status: "DRAFT",
  templateId: "tpl_1",
  contactListId: "list_1",
  cronExpression: null,
  timezone: null,
  scheduledAt: null
};

describe("campaignService.list / get", () => {
  it("lists campaigns", () => {
    prismaMock.campaign.findMany.mockResolvedValue([] as never);
    campaignService.list("org_1");
    expect(prismaMock.campaign.findMany).toHaveBeenCalled();
  });

  it("gets a campaign scoped by membership", () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    campaignService.get("c1", "user_1");
    expect(prismaMock.campaign.findFirst).toHaveBeenCalled();
  });
});

describe("campaignService.create", () => {
  it("creates a campaign validating template and contact list", async () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: "tpl_1" } as never);
    prismaMock.contactList.findFirst.mockResolvedValue({ id: "list_1" } as never);
    prismaMock.campaign.create.mockResolvedValue(draft as never);

    await campaignService.create({
      organizationId: "org_1",
      name: "Camp",
      templateId: "tpl_1",
      contactListId: "list_1",
      scheduledAt: "2026-12-01T00:00:00.000Z"
    });
    expect(prismaMock.campaign.create).toHaveBeenCalled();
  });

  it("creates a campaign with no relations", async () => {
    prismaMock.campaign.create.mockResolvedValue(draft as never);
    await campaignService.create({ organizationId: "org_1", name: "Camp" });
    expect(prismaMock.template.findFirst).not.toHaveBeenCalled();
  });

  it("throws 404 when the template is not in the org", async () => {
    prismaMock.template.findFirst.mockResolvedValue(null);
    await expect(
      campaignService.create({
        organizationId: "org_1",
        name: "Camp",
        templateId: "tpl_x"
      })
    ).rejects.toThrow("Template not found");
  });

  it("throws 404 when the contact list is not in the org", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue(null);
    await expect(
      campaignService.create({
        organizationId: "org_1",
        name: "Camp",
        contactListId: "list_x"
      })
    ).rejects.toThrow("Contact list not found");
  });
});

describe("campaignService.configureAbTest", () => {
  it("enables A/B testing and replaces variants on a draft", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    await campaignService.configureAbTest("c1", "user_1", {
      enabled: true,
      percent: 20,
      metric: "OPEN",
      windowMin: 120,
      variants: [
        { label: "A", subject: "First" },
        { label: "B", subject: "Second" }
      ]
    });
    // deleteMany (clear) + campaign.update (set config + nested variant create).
    expect(prismaMock.campaignVariant.deleteMany).toHaveBeenCalledWith({
      where: { campaignId: "c1" }
    });
    const updateData = prismaMock.campaign.update.mock.calls[0][0].data;
    expect(updateData).toMatchObject({
      abTestEnabled: true,
      abTestPercent: 20,
      abWinnerMetric: "OPEN",
      abTestWindowMin: 120
    });
  });

  it("disabling clears config and removes variants", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    await campaignService.configureAbTest("c1", "user_1", { enabled: false });
    expect(prismaMock.campaignVariant.deleteMany).toHaveBeenCalled();
    const updateData = prismaMock.campaign.update.mock.calls[0][0].data;
    expect(updateData).toMatchObject({
      abTestEnabled: false,
      abTestPercent: null,
      abWinnerMetric: null
    });
  });

  it("rejects configuring A/B on a non-draft campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "SENDING"
    } as never);
    await expect(
      campaignService.configureAbTest("c1", "user_1", { enabled: false })
    ).rejects.toThrow("A/B testing can only be configured on a draft");
  });
});

describe("campaignService.update", () => {
  it("updates a draft campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.update("c1", "user_1", { name: "New" });
    expect(prismaMock.campaign.update).toHaveBeenCalled();
  });

  it("throws 404 for a campaign the user does not own", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    await expect(
      campaignService.update("c1", "user_1", { name: "x" })
    ).rejects.toThrow("Campaign not found");
  });

  it("throws 400 when the campaign is not a draft", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "SENDING"
    } as never);
    await expect(
      campaignService.update("c1", "user_1", { name: "x" })
    ).rejects.toThrow("Only draft campaigns can be edited");
  });
});

describe("campaignService.duplicate", () => {
  it("creates a copy of an owned campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    prismaMock.campaign.create.mockResolvedValue(draft as never);
    await campaignService.duplicate("c1", "user_1");
    expect(prismaMock.campaign.create.mock.calls[0][0].data.name).toBe(
      "Copy of Camp"
    );
  });
});

describe("campaignService.delete", () => {
  it("deletes a draft campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    prismaMock.campaign.delete.mockResolvedValue(draft as never);
    await campaignService.delete("c1", "user_1");
    expect(prismaMock.campaign.delete).toHaveBeenCalled();
  });

  it("throws 400 deleting a non-draft/cancelled campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "SENDING"
    } as never);
    await expect(campaignService.delete("c1", "user_1")).rejects.toThrow(
      "Only draft or cancelled campaigns can be deleted"
    );
  });
});

describe("campaignService.sendNow", () => {
  it("moves to SENDING and enqueues", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.sendNow("c1", "user_1");
    expect(add).toHaveBeenCalledOnce();
  });

  it("throws 400 from a non-sendable status", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "SENDING"
    } as never);
    await expect(campaignService.sendNow("c1", "user_1")).rejects.toThrow(
      "Campaign cannot be sent from its current status"
    );
  });

  it("throws 400 when missing template or contact list", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      templateId: null
    } as never);
    await expect(campaignService.sendNow("c1", "user_1")).rejects.toThrow(
      "Campaign requires a template and contact list"
    );
  });
});

describe("campaignService.schedule", () => {
  const future = "2999-01-01T00:00:00.000Z";

  it("schedules a draft for the future and enqueues with delay", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.schedule("c1", "user_1", { scheduledAt: future });
    expect(add).toHaveBeenCalledOnce();
  });

  it("throws 400 from a non-schedulable status", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "SENDING"
    } as never);
    await expect(
      campaignService.schedule("c1", "user_1", { scheduledAt: future })
    ).rejects.toThrow("Only draft or scheduled campaigns can be scheduled");
  });

  it("throws 400 when missing template or contact list", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      contactListId: null
    } as never);
    await expect(
      campaignService.schedule("c1", "user_1", { scheduledAt: future })
    ).rejects.toThrow("Campaign requires a template and contact list");
  });

  it("throws 400 when the scheduled time is in the past", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    await expect(
      campaignService.schedule("c1", "user_1", {
        scheduledAt: "2000-01-01T00:00:00.000Z"
      })
    ).rejects.toThrow("scheduledAt must be in the future");
  });
});

describe("campaignService.setRecurrence", () => {
  const input = { cronExpression: "0 0 * * *", timezone: "UTC" };

  it("sets recurrence and upserts the job scheduler", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.setRecurrence("c1", "user_1", input);
    expect(upsertJobScheduler).toHaveBeenCalledOnce();
  });

  it("throws 400 from a disallowed status", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "SENDING"
    } as never);
    await expect(
      campaignService.setRecurrence("c1", "user_1", input)
    ).rejects.toThrow("Recurrence can only be set");
  });

  it("throws 400 when missing template or contact list", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      templateId: null
    } as never);
    await expect(
      campaignService.setRecurrence("c1", "user_1", input)
    ).rejects.toThrow("Campaign requires a template and contact list");
  });

  it("throws 400 when the cron expression is invalid", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    await expect(
      campaignService.setRecurrence("c1", "user_1", {
        cronExpression: "nonsense",
        timezone: "UTC"
      })
    ).rejects.toThrow("Invalid cron expression or timezone");
  });
});

describe("campaignService.pause", () => {
  it("pauses a scheduled one-shot campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "SCHEDULED"
    } as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.pause("c1", "user_1");
    expect(removeJobScheduler).not.toHaveBeenCalled();
  });

  it("pauses a recurring campaign and removes the scheduler", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "SCHEDULED",
      cronExpression: "0 0 * * *"
    } as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.pause("c1", "user_1");
    expect(removeJobScheduler).toHaveBeenCalledOnce();
  });

  it("throws 400 from a non-pausable status", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    await expect(campaignService.pause("c1", "user_1")).rejects.toThrow(
      "Only scheduled or sending campaigns can be paused"
    );
  });
});

describe("campaignService.resume", () => {
  it("throws 400 when the campaign is not paused", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    await expect(campaignService.resume("c1", "user_1")).rejects.toThrow(
      "Only paused campaigns can be resumed"
    );
  });

  it("resumes a recurring campaign by re-upserting the scheduler", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "PAUSED",
      cronExpression: "0 0 * * *",
      timezone: "UTC"
    } as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.resume("c1", "user_1");
    expect(upsertJobScheduler).toHaveBeenCalledOnce();
  });

  it("resumes a recurring campaign defaulting timezone to UTC when null", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "PAUSED",
      cronExpression: "0 0 * * *",
      timezone: null
    } as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.resume("c1", "user_1");
    expect(upsertJobScheduler.mock.calls[0][1].tz).toBe("UTC");
  });

  it("resumes a one-shot campaign still in the future as SCHEDULED", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "PAUSED",
      scheduledAt: new Date("2999-01-01T00:00:00.000Z")
    } as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.resume("c1", "user_1");
    expect(prismaMock.campaign.update.mock.calls[0][0].data.status).toBe(
      "SCHEDULED"
    );
  });

  it("resumes a past one-shot campaign as SENDING", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...draft,
      status: "PAUSED",
      scheduledAt: new Date("2000-01-01T00:00:00.000Z")
    } as never);
    prismaMock.campaign.update.mockResolvedValue(draft as never);
    await campaignService.resume("c1", "user_1");
    expect(prismaMock.campaign.update.mock.calls[0][0].data.status).toBe(
      "SENDING"
    );
  });
});

describe("campaignService.analytics", () => {
  it("aggregates totals, rates, links and recent events", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    prismaMock.emailJob.count
      .mockResolvedValueOnce(100 as never) // recipients
      .mockResolvedValueOnce(80 as never) // sent
      .mockResolvedValueOnce(5 as never); // failed
    prismaMock.emailEvent.groupBy
      .mockResolvedValueOnce([
        { type: "OPENED", _count: { _all: 40 } },
        { type: "CLICKED", _count: { _all: 20 } },
        { type: "BOUNCED", _count: { _all: 2 } },
        { type: "DELIVERED", _count: { _all: 78 } },
        { type: "COMPLAINED", _count: { _all: 1 } }
      ] as never)
      .mockResolvedValueOnce([{ emailJobId: "j1" }, { emailJobId: "j2" }] as never)
      .mockResolvedValueOnce([{ emailJobId: "j1" }] as never);
    prismaMock.emailEvent.findMany
      .mockResolvedValueOnce([
        { metadata: { url: "https://a.com" } },
        { metadata: { url: "https://a.com" } },
        { metadata: { url: "https://b.com" } },
        { metadata: null }
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "e1",
          type: "OPENED",
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
          emailJob: { toEmail: "x@y.com" }
        }
      ] as never);

    const result = await campaignService.analytics("c1", "user_1");

    expect(result.totals.recipients).toBe(100);
    expect(result.totals.opened).toBe(40);
    expect(result.totals.uniqueOpened).toBe(2);
    expect(result.totals.uniqueClicked).toBe(1);
    expect(result.totals.delivered).toBe(78);
    expect(result.links).toEqual([
      { url: "https://a.com", clicks: 2 },
      { url: "https://b.com", clicks: 1 }
    ]);
    expect(result.rates.open).toBeCloseTo(2 / 80);
    expect(result.recentEvents[0]).toMatchObject({ id: "e1", toEmail: "x@y.com" });
  });

  it("uses zero rates when nothing was sent", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(draft as never);
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.emailEvent.groupBy.mockResolvedValue([] as never);
    prismaMock.emailEvent.findMany.mockResolvedValue([] as never);

    const result = await campaignService.analytics("c1", "user_1");
    expect(result.rates.open).toBe(0);
    expect(result.rates.bounce).toBe(0);
    expect(result.links).toEqual([]);
  });
});
