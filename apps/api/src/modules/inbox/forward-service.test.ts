import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { inboxForwardService } from "./forward-service.js";
import { inboxService } from "./service.js";
vi.mock("./service.js", () => ({
  inboxService: { downloadAttachment: vi.fn() },
}));
const file = {
  id: "file1",
  filename: "private.txt",
  contentType: "text/plain",
  size: 4,
  storageKey: "private/original",
};
const original = {
  id: "m1",
  subject: "Question",
  text: "Original <script> words & details",
  bodyStatus: "AVAILABLE",
  contentImportPending: false,
  fromEmail: "sender@example.com",
  fromName: "Sender",
  receivedAt: new Date("2026-10-14T12:00:00Z"),
  to: ["support@example.com"],
  cc: ["copy@example.com"],
  inboxAccount: { email: "support@example.com" },
  attachments: [file],
};
const input = { clientId: "forward1" };
beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER",
  } as never);
  prismaMock.inboundMessage.findFirst.mockResolvedValue(original as never);
  prismaMock.emailDraft.findFirst.mockResolvedValue(null);
  prismaMock.sMTPConnection.findFirst.mockResolvedValue({
    id: "smtp1",
  } as never);
  vi.mocked(inboxService.downloadAttachment).mockResolvedValue({} as never);
  prismaMock.emailDraft.create.mockResolvedValue({
    id: "draft1",
    attachments: [file],
  } as never);
});
describe("forward preparation", () => {
  it("creates one personal draft with private original files and escaped quoted writing", async () => {
    await expect(
      inboxForwardService.prepare("m1", "org1", "u1", input)
    ).resolves.toMatchObject({ id: "draft1" });
    expect(inboxService.downloadAttachment).toHaveBeenCalledWith(
      "file1",
      "u1",
      "org1"
    );
    const data = prismaMock.emailDraft.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: "org1",
      createdByUserId: "u1",
      clientId: "forward1",
      subject: "Fwd: Question",
      smtpConnectionId: "smtp1",
      variables: { qqueueForwardSource: "m1" },
      attachments: {
        create: [
          {
            filename: "private.txt",
            storageKey: "private/original",
            createdByUserId: "u1",
            organizationId: "org1",
          },
        ],
      },
    });
    expect(data.html).toContain("Original &lt;script&gt; words &amp; details");
    expect(data.html).not.toContain("<script>");
    expect(data).not.toHaveProperty("inReplyTo");
  });
  it("recovers an existing forward after a lost response without cloning more files", async () => {
    const draft = {
      id: "d1",
      variables: { qqueueForwardSource: "m1" },
      revision: 4,
    };
    prismaMock.emailDraft.findFirst.mockResolvedValue(draft as never);
    await expect(
      inboxForwardService.prepare("m1", "org1", "u1", input)
    ).resolves.toEqual(draft);
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
    expect(inboxService.downloadAttachment).not.toHaveBeenCalled();
  });
  it("recognizes a concurrent preparation inside the transaction", async () => {
    prismaMock.emailDraft.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "d1",
        variables: { qqueueForwardSource: "m1" },
      } as never);
    await expect(
      inboxForwardService.prepare("m1", "org1", "u1", input)
    ).resolves.toMatchObject({ id: "d1" });
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
  });
  it.each([
    { deletedAt: new Date() },
    { completedSendId: "job1" },
    { variables: { qqueueForwardSource: "another" } },
  ])("rejects a completed or changed retry %j", async (change) => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      id: "d1",
      variables: { qqueueForwardSource: "m1" },
      ...change,
    } as never);
    await expect(
      inboxForwardService.prepare("m1", "org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
  });
  it("never creates a successful-looking partial forward when an original file is unavailable", async () => {
    vi.mocked(inboxService.downloadAttachment).mockRejectedValue(
      new Error("File unavailable")
    );
    await expect(
      inboxForwardService.prepare("m1", "org1", "u1", input)
    ).rejects.toThrow("File unavailable");
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
  });
  it.each([
    { bodyStatus: "UNAVAILABLE" },
    { contentImportPending: true },
    { attachments: Array.from({ length: 51 }, () => file) },
    { attachments: [{ ...file, size: 1024 * 1024 * 1024 }] },
  ])("refuses unavailable or unsupported source content %j", async (change) => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue({
      ...original,
      ...change,
    } as never);
    await expect(
      inboxForwardService.prepare("m1", "org1", "u1", input)
    ).rejects.toHaveProperty("statusCode");
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
  });
  it("enforces the receiving scope before revealing a draft and requires a usable sending account", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([]);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
    prismaMock.inboundMessage.findFirst.mockResolvedValueOnce(null);
    await expect(
      inboxForwardService.prepare("m1", "org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      prismaMock.inboundMessage.findFirst.mock.calls[0][0]?.where
    ).toMatchObject({ inboxAccountId: { in: [] } });
    expect(prismaMock.emailDraft.findFirst).not.toHaveBeenCalled();
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    await expect(
      inboxForwardService.prepare("m1", "org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

it("quotes HTML-only mail as safe readable text", async () => {
  prismaMock.inboundMessage.findFirst.mockResolvedValue({
    ...original,
    text: null,
    html: "<p>Only HTML &amp; words</p><script>bad()</script>",
  } as never);
  await inboxForwardService.prepare("m1", "org1", "u1", input);
  expect(prismaMock.emailDraft.create.mock.calls[0][0].data.html).toContain(
    "Only HTML &amp; words"
  );
  expect(prismaMock.emailDraft.create.mock.calls[0][0].data.html).not.toContain(
    "bad()"
  );
});
