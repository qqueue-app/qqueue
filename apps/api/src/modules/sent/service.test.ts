import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { sentEmailQuerySchema } from "@qqueue/shared";

const { sentService } = await import("./service.js");

/** The parsed query a request produces, with only the fields a case cares about. */
function query(overrides: Record<string, unknown> = {}) {
  return sentEmailQuerySchema.parse({
    organizationId: "org_1",
    ...overrides
  });
}

const job = {
  id: "job_1",
  subject: "Launch",
  // Manual sends store the deduplicated To set comma-joined.
  toEmail: "a@x.com, b@x.com",
  cc: ["c@x.com"],
  bcc: [],
  status: "SENT",
  origin: "MANUAL",
  sentAt: new Date("2026-07-22T09:00:00.000Z"),
  createdAt: new Date("2026-07-22T08:59:00.000Z"),
  campaignId: null,
  campaign: null,
  smtpConnection: {
    name: "Primary",
    fromEmail: "hi@acme.com",
    fromName: "Acme"
  },
  events: []
};

beforeEach(() => {
  // OWNER: the archive is unscoped, which is what most of these cases assert.
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER"
  } as never);
  prismaMock.emailJob.findMany.mockResolvedValue([] as never);
  prismaMock.emailJob.count.mockResolvedValue(0 as never);
});

describe("sentService.list mailbox scope", () => {
  beforeEach(() => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
      { smtpConnectionId: "smtp_1" }
    ] as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([] as never);
  });

  it("shows a MEMBER their mailboxes and their own sends, nothing else", async () => {
    await sentService.list(query(), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where).toMatchObject({
      organizationId: "org_1",
      AND: [
        {
          OR: [
            { smtpConnectionId: { in: ["smtp_1"] } },
            { createdByUserId: "user_1" }
          ]
        }
      ]
    });
  });

  it("keeps the scope out of reach of the search term's OR", async () => {
    // Both clauses want `OR`. If the scope were spread into the same object the
    // search would overwrite it and a member could read the whole archive by
    // typing in the search box.
    await sentService.list(query({ q: "launch" }), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where.AND).toEqual([
      {
        OR: [
          { smtpConnectionId: { in: ["smtp_1"] } },
          { createdByUserId: "user_1" }
        ]
      }
    ]);
    expect(args.where.OR).toHaveLength(3);
  });

  it("shows a member with no mailboxes only their own sends", async () => {
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([] as never);

    await sentService.list(query(), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where.AND).toEqual([
      { OR: [{ smtpConnectionId: { in: [] } }, { createdByUserId: "user_1" }] }
    ]);
  });
});

describe("sentService.list", () => {
  it("returns only terminal outcomes, newest sent first", async () => {
    await sentService.list(query(), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where).toEqual({
      organizationId: "org_1",
      status: { in: ["SENT", "FAILED"] }
    });
    // Failures have no sentAt, and Postgres would otherwise sort those NULLs
    // to the very top of the archive.
    expect(args.orderBy).toEqual([
      { sentAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" }
    ]);
  });

  it("pages in Postgres rather than in the browser", async () => {
    prismaMock.emailJob.count.mockResolvedValue(310 as never);

    const page = await sentService.list(query({ page: 3, pageSize: 25 }), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
    expect(page).toMatchObject({ total: 310, page: 3, pageSize: 25 });
  });

  it("counts with the same filters it lists with", async () => {
    await sentService.list(query({ origin: "CAMPAIGN" }), "user_1");

    const listArgs = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    const countArgs = prismaMock.emailJob.count.mock.calls[0][0]!;
    // Otherwise the pager promises pages of rows the list can never produce.
    expect(countArgs.where).toEqual(listArgs.where);
  });

  it("searches subject, recipient, and campaign name", async () => {
    await sentService.list(query({ q: "launch" }), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where?.OR).toEqual([
      { subject: { contains: "launch", mode: "insensitive" } },
      { toEmail: { contains: "launch", mode: "insensitive" } },
      { campaign: { name: { contains: "launch", mode: "insensitive" } } }
    ]);
  });

  it.each([
    ["delivered", "DELIVERED"],
    ["opened", "OPENED"],
    ["clicked", "CLICKED"],
    ["bounced", "BOUNCED"],
    ["complained", "COMPLAINED"]
  ])("filters %s against the event the pipeline wrote", async (outcome, type) => {
    await sentService.list(query({ outcome }), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where?.events).toEqual({ some: { type } });
    expect(args.where?.status).toEqual({ in: ["SENT", "FAILED"] });
  });

  it("filters failures on the job's own status, not an event", async () => {
    await sentService.list(query({ outcome: "failed" }), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where?.status).toBe("FAILED");
    expect(args.where?.events).toBeUndefined();
  });

  it("narrows to one sending account and origin", async () => {
    await sentService.list(
      query({ origin: "TRANSACTIONAL", smtpConnectionId: "smtp_1" }),
      "user_1"
    );

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where).toMatchObject({
      origin: "TRANSACTIONAL",
      smtpConnectionId: "smtp_1"
    });
  });

  it("windows on createdAt so failures stay inside the range", async () => {
    await sentService.list(query({ days: 7 }), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    const gte = (args.where?.createdAt as { gte: Date }).gte;
    const days = (Date.now() - gte.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 1);
  });

  it("applies no date bound for the all-time window", async () => {
    await sentService.list(query({ days: 0 }), "user_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where?.createdAt).toBeUndefined();
  });

  it("splits the joined To set and surfaces the sending account", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([job] as never);

    const { rows } = await sentService.list(query(), "user_1");

    expect(rows[0].to).toEqual(["a@x.com", "b@x.com"]);
    expect(rows[0].ccCount).toBe(1);
    expect(rows[0].bccCount).toBe(0);
    expect(rows[0].sentAt).toBe("2026-07-22T09:00:00.000Z");
    expect(rows[0].sendingAccount).toEqual({
      name: "Primary",
      fromEmail: "hi@acme.com",
      fromName: "Acme"
    });
  });

  it("folds a job's events into engagement counts and flags", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        ...job,
        events: [
          { type: "SENT" },
          { type: "DELIVERED" },
          { type: "OPENED" },
          { type: "OPENED" },
          { type: "CLICKED" }
        ]
      }
    ] as never);

    const { rows } = await sentService.list(query(), "user_1");

    // Repeat opens are a count, not five rows the browser has to reduce.
    expect(rows[0]).toMatchObject({
      delivered: true,
      opens: 2,
      clicks: 1,
      bounced: false,
      complained: false
    });
  });

  it("labels a campaign send with its campaign", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        ...job,
        origin: "CAMPAIGN",
        campaignId: "camp_1",
        campaign: { name: "July newsletter" }
      }
    ] as never);

    const { rows } = await sentService.list(query(), "user_1");

    expect(rows[0].campaignId).toBe("camp_1");
    expect(rows[0].campaignName).toBe("July newsletter");
  });
});

describe("sentService.get", () => {
  /** The archived job a detail request resolves, with its body and history. */
  function detailJob(overrides: Record<string, unknown> = {}) {
    return {
      ...job,
      replyTo: null,
      messageId: "<abc@acme.com>",
      html: "<p>Hello</p>",
      text: "Hello",
      attachments: [],
      events: [
        {
          id: "ev_1",
          type: "SENT",
          occurredAt: new Date("2026-07-22T09:00:00.000Z"),
          metadata: null
        }
      ],
      ...overrides
    };
  }

  it("returns the stored body, addresses and history", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(detailJob() as never);

    const email = await sentService.get("job_1", "org_1", "user_1");

    expect(email).toMatchObject({
      id: "job_1",
      html: "<p>Hello</p>",
      text: "Hello",
      cc: ["c@x.com"],
      bcc: [],
      messageId: "<abc@acme.com>",
      to: ["a@x.com", "b@x.com"]
    });
    expect(email.events).toEqual([
      {
        id: "ev_1",
        type: "SENT",
        occurredAt: "2026-07-22T09:00:00.000Z",
        detail: null
      }
    ]);
  });

  it("reads the archive's terminal statuses only", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(detailJob() as never);

    await sentService.get("job_1", "org_1", "user_1");

    // A queued or cancelled job is not in the archive, so it is not openable
    // from it either — the outbox owns those.
    expect(prismaMock.emailJob.findFirst.mock.calls[0][0]!.where).toMatchObject({
      id: "job_1",
      organizationId: "org_1",
      status: { in: ["SENT", "FAILED"] }
    });
  });

  it("applies the same mailbox scope the list does", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
      { smtpConnectionId: "smtp_1" }
    ] as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([] as never);
    prismaMock.emailJob.findFirst.mockResolvedValue(detailJob() as never);

    await sentService.get("job_1", "org_1", "user_1");

    expect(prismaMock.emailJob.findFirst.mock.calls[0][0]!.where).toMatchObject({
      AND: [
        {
          OR: [
            { smtpConnectionId: { in: ["smtp_1"] } },
            { createdByUserId: "user_1" }
          ]
        }
      ]
    });
  });

  it("404s rather than 403s for a message outside the reader's scope", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(null as never);

    await expect(
      sentService.get("job_1", "org_1", "user_1")
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("splits parts into inline and attached by their Content-ID", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(
      detailJob({
        attachments: [
          {
            id: "att_1",
            filename: "report.pdf",
            contentType: "application/pdf",
            size: 12,
            cid: null
          },
          {
            id: "att_2",
            filename: "qr.png",
            contentType: "image/png",
            size: 34,
            cid: "<qr@acme>"
          }
        ]
      }) as never
    );

    const email = await sentService.get("job_1", "org_1", "user_1");

    expect(email.attachments).toEqual([
      {
        id: "att_1",
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 12,
        isInline: false,
        contentId: null
      },
      {
        id: "att_2",
        filename: "qr.png",
        contentType: "image/png",
        size: 34,
        isInline: true,
        contentId: "<qr@acme>"
      }
    ]);
  });

  it.each([
    ["FAILED", { message: "550 no such user" }, "550 no such user"],
    ["BOUNCED", { reason: "mailbox full" }, "mailbox full"]
  ])("lifts the reason out of a %s event", async (type, metadata, expected) => {
    prismaMock.emailJob.findFirst.mockResolvedValue(
      detailJob({
        status: "FAILED",
        events: [
          {
            id: "ev_1",
            type,
            occurredAt: new Date("2026-07-22T09:00:00.000Z"),
            metadata
          }
        ]
      }) as never
    );

    const email = await sentService.get("job_1", "org_1", "user_1");

    // Surfaced on its own so the reader doesn't have to know that "Failed" is a
    // status while the reason is an event.
    expect(email.failureReason).toBe(expected);
    expect(email.events[0].detail).toBe(expected);
  });

  it("reports no failure reason for a message that did not fail", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(
      detailJob({
        status: "SENT",
        events: [
          {
            id: "ev_1",
            type: "BOUNCED",
            occurredAt: new Date("2026-07-22T09:00:00.000Z"),
            metadata: { reason: "soft bounce, retried" }
          }
        ]
      }) as never
    );

    const email = await sentService.get("job_1", "org_1", "user_1");

    // A delivered message with an old soft bounce on record has not failed.
    expect(email.failureReason).toBeNull();
  });

  it("survives event metadata in a shape it does not recognise", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(
      detailJob({
        events: [
          {
            id: "ev_1",
            type: "CLICKED",
            occurredAt: new Date("2026-07-22T09:00:00.000Z"),
            // Written by several code paths over several releases; a shape that
            // has since changed must degrade, never throw mid-render.
            metadata: ["not", "an", "object"]
          },
          {
            id: "ev_2",
            type: "CLICKED",
            occurredAt: new Date("2026-07-22T09:05:00.000Z"),
            metadata: { url: "https://acme.com/pricing" }
          }
        ]
      }) as never
    );

    const email = await sentService.get("job_1", "org_1", "user_1");

    expect(email.events[0].detail).toBeNull();
    expect(email.events[1].detail).toBe("https://acme.com/pricing");
  });
});

describe("sentEmailQuerySchema", () => {
  it("defaults to the whole archive, newest page first", () => {
    expect(query()).toMatchObject({
      origin: "all",
      outcome: "all",
      days: 0,
      page: 1,
      pageSize: 25
    });
  });

  it("caps the page size so one request can't ask for the whole table", () => {
    expect(() =>
      sentEmailQuerySchema.parse({ organizationId: "org_1", pageSize: 5000 })
    ).toThrow();
  });
});
