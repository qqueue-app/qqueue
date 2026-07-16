import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  invitationService: {
    create: vi.fn(),
    list: vi.fn(),
    revoke: vi.fn(),
    lookup: vi.fn(),
    accept: vi.fn()
  }
}));

const { invitationController } = await import("./controller.js");
const { invitationService } = await import("./service.js");
const { HttpError } = await import("../../lib/http-error.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

// toMatchObject does not traverse Error instances, so assert on the thrown
// HttpError's own fields directly.
async function expectHttpError(promise: Promise<unknown>, statusCode: number, message?: string) {
  await expect(promise).rejects.toBeInstanceOf(HttpError);
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught as InstanceType<typeof HttpError>
  );
  expect(error?.statusCode).toBe(statusCode);
  if (message !== undefined) {
    expect(error?.message).toBe(message);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("invitationController.create", () => {
  it("creates an invitation and responds 201", async () => {
    const result = {
      invite: { id: "inv_1", email: "new@example.com", role: "ADMIN" },
      acceptUrl: "https://app.example.com/accept-invite?token=tok"
    };
    vi.mocked(invitationService.create).mockResolvedValue(result as never);
    const res = mockRes();

    await invitationController.create(
      {
        body: { organizationId: "org_1", email: "new@example.com", role: "ADMIN" },
        userId: "usr_1"
      } as Request,
      res
    );

    expect(invitationService.create).toHaveBeenCalledWith(
      { organizationId: "org_1", email: "new@example.com", role: "ADMIN" },
      "usr_1"
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("applies the schema's MEMBER role default when the body omits it", async () => {
    vi.mocked(invitationService.create).mockResolvedValue({ invite: { id: "inv_1" } } as never);

    await invitationController.create(
      { body: { organizationId: "org_1", email: "new@example.com" }, userId: "usr_1" } as Request,
      mockRes()
    );

    expect(invitationService.create).toHaveBeenCalledWith(
      { organizationId: "org_1", email: "new@example.com", role: "MEMBER" },
      "usr_1"
    );
  });

  it("surfaces the 409 when the invitee is already a member", async () => {
    vi.mocked(invitationService.create).mockRejectedValue(
      new HttpError(409, "That person is already a member of this organization")
    );

    await expect(
      invitationController.create(
        { body: { organizationId: "org_1", email: "old@example.com" }, userId: "usr_1" } as Request,
        mockRes()
      )
    ).rejects.toThrow("That person is already a member of this organization");
  });

  it("rejects a malformed email before reaching the service", async () => {
    await expect(
      invitationController.create(
        { body: { organizationId: "org_1", email: "nope" }, userId: "usr_1" } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(invitationService.create).not.toHaveBeenCalled();
  });

  it("rejects a missing organizationId before reaching the service", async () => {
    await expect(
      invitationController.create(
        { body: { email: "new@example.com" }, userId: "usr_1" } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(invitationService.create).not.toHaveBeenCalled();
  });
});

describe("invitationController.list", () => {
  it("lists pending invitations for the organizationId query param", async () => {
    const invites = [{ id: "inv_1" }];
    vi.mocked(invitationService.list).mockResolvedValue(invites as never);
    const res = mockRes();

    await invitationController.list(
      { query: { organizationId: "org_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(invitationService.list).toHaveBeenCalledWith("org_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: invites });
  });

  it("stringifies a missing organizationId rather than throwing — the service rejects it", async () => {
    vi.mocked(invitationService.list).mockRejectedValue(new HttpError(403, "Forbidden"));

    await expect(
      invitationController.list({ query: {}, userId: "usr_1" } as unknown as Request, mockRes())
    ).rejects.toThrow("Forbidden");
    expect(invitationService.list).toHaveBeenCalledWith("undefined", "usr_1");
  });
});

describe("invitationController.revoke", () => {
  it("revokes by id and returns the updated invite", async () => {
    const invite = { id: "inv_1", status: "REVOKED" };
    vi.mocked(invitationService.revoke).mockResolvedValue(invite as never);
    const res = mockRes();

    await invitationController.revoke(
      { params: { id: "inv_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(invitationService.revoke).toHaveBeenCalledWith("inv_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: invite });
  });

  it("surfaces the 404 for an unknown invitation", async () => {
    vi.mocked(invitationService.revoke).mockRejectedValue(
      new HttpError(404, "Invitation not found")
    );

    await expect(
      invitationController.revoke(
        { params: { id: "inv_missing" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Invitation not found");
  });
});

describe("invitationController.lookup", () => {
  it("previews the invite from its token query param", async () => {
    const preview = {
      email: "new@example.com",
      role: "MEMBER",
      organizationName: "Acme",
      hasAccount: false
    };
    vi.mocked(invitationService.lookup).mockResolvedValue(preview as never);
    const res = mockRes();

    await invitationController.lookup({ query: { token: "tok" } } as unknown as Request, res);

    expect(invitationService.lookup).toHaveBeenCalledWith("tok");
    expect(res.json).toHaveBeenCalledWith({ data: preview });
  });

  it("throws 400 when the token is absent", async () => {
    await expectHttpError(
      invitationController.lookup({ query: {} } as unknown as Request, mockRes()),
      400,
      "token is required"
    );
    expect(invitationService.lookup).not.toHaveBeenCalled();
  });

  it("throws 400 when the token is empty", async () => {
    await expectHttpError(
      invitationController.lookup({ query: { token: "" } } as unknown as Request, mockRes()),
      400
    );
    expect(invitationService.lookup).not.toHaveBeenCalled();
  });

  it("throws 400 when the token repeats into an array — Express gives ?token=a&token=b", async () => {
    await expectHttpError(
      invitationController.lookup(
        { query: { token: ["a", "b"] } } as unknown as Request,
        mockRes()
      ),
      400
    );
    expect(invitationService.lookup).not.toHaveBeenCalled();
  });
});

describe("invitationController.accept", () => {
  const token = "a".repeat(16);

  it("accepts for a brand-new account and returns tokens (requiresSignIn false)", async () => {
    const result = {
      user: { id: "usr_2" },
      organization: { id: "org_1", name: "Acme" },
      role: "MEMBER",
      requiresSignIn: false,
      tokens: { accessToken: "at", refreshToken: "rt" }
    };
    vi.mocked(invitationService.accept).mockResolvedValue(result as never);
    const res = mockRes();

    await invitationController.accept(
      { body: { token, password: "supersecret", name: "New Person" } } as Request,
      res
    );

    expect(invitationService.accept).toHaveBeenCalledWith({
      token,
      password: "supersecret",
      name: "New Person"
    });
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("accepts for an existing account and relays requiresSignIn/alreadyMember", async () => {
    const result = {
      organization: { id: "org_1", name: "Acme" },
      requiresSignIn: true,
      alreadyMember: true
    };
    vi.mocked(invitationService.accept).mockResolvedValue(result as never);
    const res = mockRes();

    // password/name are optional: an existing account is granted membership and
    // asked to sign in rather than being issued tokens.
    await invitationController.accept({ body: { token } } as Request, res);

    expect(invitationService.accept).toHaveBeenCalledWith({ token });
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a token shorter than the 16-char minimum", async () => {
    await expect(
      invitationController.accept({ body: { token: "short" } } as Request, mockRes())
    ).rejects.toThrow();
    expect(invitationService.accept).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    await expect(
      invitationController.accept({ body: { token, password: "abc" } } as Request, mockRes())
    ).rejects.toThrow();
    expect(invitationService.accept).not.toHaveBeenCalled();
  });
});
