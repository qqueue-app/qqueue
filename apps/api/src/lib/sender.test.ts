import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { encryptSecret } from "./crypto.js";
import {
  dkimSignOptionsFor,
  formatSenderFrom,
  resolveSender,
  type ResolvedSender
} from "./sender.js";

const smtp = {
  id: "smtp_1",
  host: "smtp.acme.com",
  port: 587,
  secure: true,
  usernameEncrypted: "u",
  passwordEncrypted: "p",
  fromEmail: "ops@acme.com",
  fromName: "Acme Ops"
};

const sendingDomain = {
  domain: "acme.com",
  dkimMode: "MANAGED" as const,
  dkimStatus: "VERIFIED" as const,
  dkimSelector: "qqueue",
  dkimPrivateKeyEncrypted: encryptSecret("PRIVATE-KEY-PEM")
};

const identity = {
  id: "ident_1",
  fromEmail: "noreply@acme.com",
  fromName: "Acme",
  replyTo: "support@acme.com",
  smtpConnection: smtp,
  sendingDomain
};

beforeEach(() => {
  prismaMock.senderIdentity.findFirst.mockResolvedValue(null);
  prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
});

describe("resolveSender precedence", () => {
  it("uses an explicit sender identity", async () => {
    prismaMock.senderIdentity.findFirst.mockResolvedValue(identity as never);
    const result = await resolveSender("org_1", { senderIdentityId: "ident_1" });
    expect(result.senderIdentityId).toBe("ident_1");
    expect(result.fromEmail).toBe("noreply@acme.com");
    expect(result.replyTo).toBe("support@acme.com");
    expect(result.sendingDomain?.domain).toBe("acme.com");
  });

  it("throws when the referenced identity is missing", async () => {
    await expect(
      resolveSender("org_1", { senderIdentityId: "missing" })
    ).rejects.toThrow("Sender identity not found");
  });

  it("falls back to an explicit SMTP connection (legacy)", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtp as never);
    const result = await resolveSender("org_1", { smtpConnectionId: "smtp_1" });
    expect(result.senderIdentityId).toBeNull();
    expect(result.fromEmail).toBe("ops@acme.com");
    expect(result.sendingDomain).toBeNull();
  });

  it("uses the org default identity when nothing is specified", async () => {
    prismaMock.senderIdentity.findFirst.mockResolvedValue(identity as never);
    const result = await resolveSender("org_1", {});
    expect(result.senderIdentityId).toBe("ident_1");
  });

  it("falls back to the org default SMTP connection", async () => {
    prismaMock.senderIdentity.findFirst.mockResolvedValue(null);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtp as never);
    const result = await resolveSender("org_1", {});
    expect(result.senderIdentityId).toBeNull();
    expect(result.fromEmail).toBe("ops@acme.com");
  });

  it("throws when nothing is configured to send from", async () => {
    await expect(resolveSender("org_1", {})).rejects.toThrow(
      "No sender identity or SMTP connection configured"
    );
  });
});

describe("dkimSignOptionsFor", () => {
  function sender(over: Partial<ResolvedSender>): ResolvedSender {
    return {
      senderIdentityId: "ident_1",
      smtpConnection: smtp,
      fromEmail: "noreply@acme.com",
      fromName: "Acme",
      replyTo: null,
      sendingDomain,
      ...over
    };
  }

  it("signs managed + verified domains with the decrypted key", () => {
    const options = dkimSignOptionsFor(sender({}));
    expect(options).toEqual({
      domainName: "acme.com",
      keySelector: "qqueue",
      privateKey: "PRIVATE-KEY-PEM"
    });
  });

  it("does not sign external domains", () => {
    expect(dkimSignOptionsFor(sender({ sendingDomain: null }))).toBeUndefined();
  });

  it("does not sign unverified managed domains", () => {
    expect(
      dkimSignOptionsFor(
        sender({
          sendingDomain: { ...sendingDomain, dkimStatus: "PENDING" }
        })
      )
    ).toBeUndefined();
  });

  it("does not sign when the private key is missing", () => {
    expect(
      dkimSignOptionsFor(
        sender({
          sendingDomain: { ...sendingDomain, dkimPrivateKeyEncrypted: null }
        })
      )
    ).toBeUndefined();
  });
});

describe("formatSenderFrom", () => {
  it("includes the display name when present", () => {
    expect(
      formatSenderFrom({ fromEmail: "a@b.com", fromName: "Acme" })
    ).toBe("Acme <a@b.com>");
  });

  it("uses the bare address when there is no name", () => {
    expect(formatSenderFrom({ fromEmail: "a@b.com", fromName: null })).toBe(
      "a@b.com"
    );
  });
});
