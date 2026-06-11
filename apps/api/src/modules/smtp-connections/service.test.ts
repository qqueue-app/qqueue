import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";

const verify = vi.fn();
const send = vi.fn();

vi.mock("@qqueue/email-engine", () => ({
  SMTPProvider: vi.fn().mockImplementation((config: unknown) => ({
    config,
    verify,
    send
  }))
}));

const { smtpConnectionService } = await import("./service.js");
const { SECRET_DECRYPTION_MESSAGE, decryptSecret, encryptSecret } = await import(
  "../../lib/crypto.js"
);

const createInput = {
  organizationId: "org_1",
  name: "Primary",
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "user",
  password: "pass",
  fromEmail: "a@b.com",
  fromName: "A"
};

beforeEach(() => {
  verify.mockReset().mockResolvedValue(undefined);
  send.mockReset();
});

describe("smtpConnectionService.list / get", () => {
  it("lists connections", () => {
    prismaMock.sMTPConnection.findMany.mockResolvedValue([] as never);
    smtpConnectionService.list("org_1");
    expect(prismaMock.sMTPConnection.findMany).toHaveBeenCalled();
  });

  it("gets an owned connection", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "s1" } as never);
    prismaMock.sMTPConnection.findUnique.mockResolvedValue({ id: "s1" } as never);
    const result = await smtpConnectionService.get("s1", "user_1");
    expect(result).toEqual({ id: "s1" });
  });

  it("throws 404 getting a connection the user does not own", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    await expect(smtpConnectionService.get("s1", "user_1")).rejects.toThrow(
      "SMTP connection not found"
    );
  });
});

describe("smtpConnectionService.create", () => {
  it("verifies, becomes default when first connection, and stores encrypted secrets", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null); // no existing default
    prismaMock.sMTPConnection.create.mockResolvedValue({ id: "s1" } as never);

    await smtpConnectionService.create(createInput);

    expect(verify).toHaveBeenCalledOnce();
    const data = prismaMock.sMTPConnection.create.mock.calls[0][0].data;
    expect(data.isDefault).toBe(true);
    expect(decryptSecret(data.usernameEncrypted as string)).toBe("user");
    expect(decryptSecret(data.passwordEncrypted as string)).toBe("pass");
  });

  it("clears other defaults when explicitly default", async () => {
    prismaMock.sMTPConnection.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.sMTPConnection.create.mockResolvedValue({ id: "s1" } as never);

    await smtpConnectionService.create({ ...createInput, isDefault: true });
    expect(prismaMock.sMTPConnection.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      data: { isDefault: false }
    });
  });

  it("is not default when another default already exists", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "other" } as never);
    prismaMock.sMTPConnection.create.mockResolvedValue({ id: "s1" } as never);
    await smtpConnectionService.create(createInput);
    expect(prismaMock.sMTPConnection.create.mock.calls[0][0].data.isDefault).toBe(
      false
    );
  });

  it("throws 400 with the provider message when verification fails", async () => {
    verify.mockRejectedValue(new Error("connection refused"));
    await expect(smtpConnectionService.create(createInput)).rejects.toThrow(
      "SMTP verification failed: connection refused"
    );
  });

  it("throws a generic 400 when verification rejects with a non-Error", async () => {
    verify.mockRejectedValue("nope");
    await expect(smtpConnectionService.create(createInput)).rejects.toThrow(
      "SMTP verification failed"
    );
  });
});

describe("smtpConnectionService.update", () => {
  const existing = {
    id: "s1",
    organizationId: "org_1",
    host: "old.example.com",
    port: 25,
    secure: false,
    usernameEncrypted: encryptSecret("old-user"),
    passwordEncrypted: encryptSecret("old-pass"),
    isDefault: false
  };

  it("keeps existing secrets when none are provided and preserves isDefault", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(existing as never);
    prismaMock.sMTPConnection.update.mockResolvedValue({ id: "s1" } as never);

    await smtpConnectionService.update("s1", "user_1", { name: "Renamed" });
    const data = prismaMock.sMTPConnection.update.mock.calls[0][0].data;
    expect(decryptSecret(data.usernameEncrypted as string)).toBe("old-user");
    expect(decryptSecret(data.passwordEncrypted as string)).toBe("old-pass");
    expect(data.isDefault).toBe(false);
  });

  it("re-encrypts new secrets and recomputes default when toggled on", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(existing as never);
    prismaMock.sMTPConnection.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.sMTPConnection.update.mockResolvedValue({ id: "s1" } as never);

    await smtpConnectionService.update("s1", "user_1", {
      username: "newuser",
      password: "newpass",
      isDefault: true
    });
    const data = prismaMock.sMTPConnection.update.mock.calls[0][0].data;
    expect(decryptSecret(data.usernameEncrypted as string)).toBe("newuser");
    expect(decryptSecret(data.passwordEncrypted as string)).toBe("newpass");
    expect(data.isDefault).toBe(true);
  });

  it("throws 404 updating a connection the user does not own", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    await expect(
      smtpConnectionService.update("s1", "user_1", { name: "x" })
    ).rejects.toThrow(HttpError);
  });

  it("returns a clear error when existing secrets cannot be decrypted", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({
      ...existing,
      usernameEncrypted: "not-a-valid-secret"
    } as never);

    await expect(
      smtpConnectionService.update("s1", "user_1", { name: "Renamed" })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: SECRET_DECRYPTION_MESSAGE
    });
  });
});

describe("smtpConnectionService.delete", () => {
  it("deletes an owned connection", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "s1" } as never);
    prismaMock.sMTPConnection.delete.mockResolvedValue({ id: "s1" } as never);
    await smtpConnectionService.delete("s1", "user_1");
    expect(prismaMock.sMTPConnection.delete).toHaveBeenCalledWith({
      where: { id: "s1" }
    });
  });

  it("throws 404 deleting a connection the user does not own", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    await expect(smtpConnectionService.delete("s1", "user_1")).rejects.toThrow(
      "SMTP connection not found"
    );
  });
});

describe("smtpConnectionService.getProviderForConnection", () => {
  it("builds a provider from decrypted credentials", () => {
    const provider = smtpConnectionService.getProviderForConnection({
      host: "h",
      port: 1,
      secure: true,
      usernameEncrypted: encryptSecret("u"),
      passwordEncrypted: encryptSecret("p")
    });
    expect(provider).toBeDefined();
  });

  it("throws a clear HttpError when credentials cannot be decrypted", () => {
    expect(() =>
      smtpConnectionService.getProviderForConnection({
        host: "h",
        port: 1,
        secure: true,
        usernameEncrypted: "not-a-valid-secret",
        passwordEncrypted: encryptSecret("p")
      })
    ).toThrow(SECRET_DECRYPTION_MESSAGE);
  });
});
