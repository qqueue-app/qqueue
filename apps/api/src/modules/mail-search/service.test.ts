import { beforeEach, describe, expect, it } from "vitest";
import { mailSearchSchema } from "@qqueue/shared";
import { prismaMock } from "../../test/prisma-mock.js";
import { mailSearchService } from "./service.js";
const row = {
  kind: "SENT",
  id: "j1",
  messageId: "<j1>",
  subject: "Question",
  fromEmail: "support@example.com",
  fromName: null,
  to: ["customer@example.com"],
  cc: [],
  at: new Date("2026-10-15T10:00:00Z"),
  preview: "Body",
  mailboxEmail: "support@example.com",
  inboxAccountId: null,
  smtpConnectionId: "s1",
  status: "SENT",
  read: true,
  label: "Sent",
};
beforeEach(() => {
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER",
  } as never);
  prismaMock.$queryRaw.mockResolvedValue([]);
});
describe("unified mail search", () => {
  it("keeps pagination boundaries on the last shown row and binds cursors to user, org and filters", async () => {
    prismaMock.$queryRaw.mockResolvedValue([row, { ...row, id: "j2" }]);
    const input = mailSearchSchema.parse({ q: "Question", limit: 1 });
    const first = await mailSearchService.search("org1", "u1", input);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].at).toBe("2026-10-15T10:00:00.000Z");
    expect(first.nextCursor).toBeTruthy();
    const parsed = JSON.parse(
      Buffer.from(first.nextCursor!, "base64url").toString()
    );
    expect(parsed.id).toBe("j1");
    prismaMock.$queryRaw.mockResolvedValue([]);
    await expect(
      mailSearchService.search("org1", "u1", {
        ...input,
        cursor: first.nextCursor!,
      })
    ).resolves.toMatchObject({ rows: [], nextCursor: null });
    for (const [org, user, changed] of [
      ["org2", "u1", input],
      ["org1", "u2", input],
      ["org1", "u1", { ...input, q: "Different" }],
    ] as const)
      await expect(
        mailSearchService.search(org, user, {
          ...changed,
          cursor: first.nextCursor!,
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      mailSearchService.search("org1", "u1", {
        ...input,
        cursor: Buffer.from(JSON.stringify({ ...parsed, id: 77 })).toString(
          "base64url"
        ),
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      mailSearchService.search("org1", "u1", { ...input, cursor: "not-json" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("binds recipient grants and literal search text as SQL parameters", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([
      { inboxAccountId: "a1" },
    ] as never);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
      { smtpConnectionId: "s1" },
    ] as never);
    await mailSearchService.search(
      "org1",
      "u1",
      mailSearchSchema.parse({
        q: "'_%",
        mailbox: "support@example.com",
        view: "SENT",
      })
    );
    const query = prismaMock.$queryRaw.mock.calls[0][0] as {
      sql: string;
      values: unknown[];
    };
    expect(query.sql).not.toContain("'_%");
    expect(query.values).toEqual(
      expect.arrayContaining([
        "org1",
        "u1",
        "a1",
        "s1",
        "support@example.com",
        "%'\\_\\%%",
      ])
    );
  });
  it.each(["ALL", "RECEIVED", "SENT", "DRAFTS", "OUTBOX"] as const)(
    "supports %s without widening an empty grant set",
    async (view) => {
      prismaMock.organizationMember.findUnique.mockResolvedValue({
        role: "MEMBER",
      } as never);
      prismaMock.inboxAccountGrant.findMany.mockResolvedValue([]);
      prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
      expect(
        await mailSearchService.search(
          "org1",
          "u1",
          mailSearchSchema.parse({ view })
        )
      ).toEqual({ rows: [], nextCursor: null });
    }
  );
  it("lists the union of authorized incoming/outgoing mailbox addresses once", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([
      { inboxAccountId: "a1" },
    ] as never);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
      { smtpConnectionId: "s1" },
    ] as never);
    prismaMock.inboxAccount.findMany.mockResolvedValue([
      { email: "Support@Example.com", name: "Inbox" },
    ] as never);
    prismaMock.sMTPConnection.findMany.mockResolvedValue([
      { fromEmail: "support@example.com", name: "Sending" },
      { fromEmail: "other@example.com", name: "Other" },
    ] as never);
    expect(await mailSearchService.mailboxes("org1", "u1")).toEqual([
      { email: "other@example.com", name: "Other" },
      { email: "support@example.com", name: "Sending" },
    ]);
    expect(prismaMock.inboxAccount.findMany.mock.calls[0][0]?.where).toEqual({
      organizationId: "org1",
      id: { in: ["a1"] },
    });
  });
});

it("excludes a revoked admin's own sent mail from raw SQL search", async () => {
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "ADMIN",
  } as never);
  prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
    { smtpConnectionId: "private-smtp" },
  ] as never);
  prismaMock.inboxAccountGrant.findMany.mockResolvedValue([
    { inboxAccountId: "private-inbox" },
  ] as never);
  prismaMock.sMTPConnection.findMany.mockResolvedValue([
    { id: "allowed-smtp" },
  ] as never);
  prismaMock.inboxAccount.findMany.mockResolvedValue([
    { id: "allowed-inbox" },
  ] as never);
  prismaMock.$queryRaw.mockResolvedValue([]);
  await mailSearchService.search(
    "org1",
    "admin",
    mailSearchSchema.parse({ view: "SENT" })
  );
  const query = prismaMock.$queryRaw.mock.calls[0][0] as {
    sql: string;
    values: unknown[];
  };
  expect(query.sql).toContain('j."smtpConnectionId" NOT IN');
  expect(query.values).toContain("private-smtp");
  expect(query.values).toContain("allowed-smtp");
});
