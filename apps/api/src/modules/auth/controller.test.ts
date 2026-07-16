import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  authService: {
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn()
  }
}));

const { authController } = await import("./controller.js");
const { authService } = await import("./service.js");

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

describe("authController.register", () => {
  it("registers a user and responds 201", async () => {
    const result = {
      user: { id: "usr_1", email: "founder@example.com" },
      organization: { id: "org_1" },
      tokens: { accessToken: "at", refreshToken: "rt" }
    };
    vi.mocked(authService.register).mockResolvedValue(result as never);
    const res = mockRes();

    await authController.register(
      {
        body: {
          email: "founder@example.com",
          password: "supersecret",
          name: "Founder",
          organizationName: "Acme"
        }
      } as Request,
      res
    );

    expect(authService.register).toHaveBeenCalledWith({
      email: "founder@example.com",
      password: "supersecret",
      name: "Founder",
      organizationName: "Acme"
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("passes through the minimal body: name/organizationName are optional", async () => {
    vi.mocked(authService.register).mockResolvedValue({ user: { id: "usr_1" } } as never);

    await authController.register(
      { body: { email: "solo@example.com", password: "supersecret" } } as Request,
      mockRes()
    );

    expect(authService.register).toHaveBeenCalledWith({
      email: "solo@example.com",
      password: "supersecret"
    });
  });

  it("surfaces the closed-registration rejection from the service", async () => {
    // Registration gating (and the zero-users bootstrap exception) is decided in
    // the service; the controller must not swallow the refusal.
    vi.mocked(authService.register).mockRejectedValue(new Error("Registration is closed"));

    await expect(
      authController.register(
        { body: { email: "late@example.com", password: "supersecret" } } as Request,
        mockRes()
      )
    ).rejects.toThrow("Registration is closed");
  });

  it("rejects a password shorter than 8 characters before reaching the service", async () => {
    await expect(
      authController.register(
        { body: { email: "founder@example.com", password: "short" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(authService.register).not.toHaveBeenCalled();
  });

  it("rejects a malformed email before reaching the service", async () => {
    await expect(
      authController.register(
        { body: { email: "not-an-email", password: "supersecret" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(authService.register).not.toHaveBeenCalled();
  });
});

describe("authController.login", () => {
  it("logs in and responds 200 with the session envelope", async () => {
    const result = {
      user: { id: "usr_1" },
      organizations: [{ id: "org_1", role: "OWNER" }],
      tokens: { accessToken: "at", refreshToken: "rt" }
    };
    vi.mocked(authService.login).mockResolvedValue(result as never);
    const res = mockRes();

    await authController.login(
      { body: { email: "founder@example.com", password: "supersecret" } } as Request,
      res
    );

    expect(authService.login).toHaveBeenCalledWith({
      email: "founder@example.com",
      password: "supersecret"
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects an empty password before reaching the service", async () => {
    await expect(
      authController.login(
        { body: { email: "founder@example.com", password: "" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(authService.login).not.toHaveBeenCalled();
  });
});

describe("authController.refresh", () => {
  it("unwraps refreshToken from the body and passes it as a bare string", async () => {
    const result = { tokens: { accessToken: "at2", refreshToken: "rt2" } };
    vi.mocked(authService.refresh).mockResolvedValue(result as never);
    const res = mockRes();

    await authController.refresh({ body: { refreshToken: "rt" } } as Request, res);

    expect(authService.refresh).toHaveBeenCalledWith("rt");
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a missing refreshToken before reaching the service", async () => {
    await expect(authController.refresh({ body: {} } as Request, mockRes())).rejects.toThrow();
    expect(authService.refresh).not.toHaveBeenCalled();
  });
});

describe("authController.requestPasswordReset", () => {
  it("passes only the email through and returns the neutral message", async () => {
    const result = {
      message: "If an account exists for that email, a password reset link has been prepared."
    };
    vi.mocked(authService.requestPasswordReset).mockResolvedValue(result as never);
    const res = mockRes();

    await authController.requestPasswordReset(
      { body: { email: "founder@example.com" } } as Request,
      res
    );

    expect(authService.requestPasswordReset).toHaveBeenCalledWith("founder@example.com");
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a malformed email before reaching the service", async () => {
    await expect(
      authController.requestPasswordReset({ body: { email: "nope" } } as Request, mockRes())
    ).rejects.toThrow();
    expect(authService.requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe("authController.resetPassword", () => {
  const token = "a".repeat(32);

  it("splits the body into positional (token, password) service args", async () => {
    const result = { message: "Password has been reset." };
    vi.mocked(authService.resetPassword).mockResolvedValue(result as never);
    const res = mockRes();

    await authController.resetPassword(
      { body: { token, password: "brandnewsecret" } } as Request,
      res
    );

    expect(authService.resetPassword).toHaveBeenCalledWith(token, "brandnewsecret");
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a token shorter than the 32-char minimum", async () => {
    await expect(
      authController.resetPassword(
        { body: { token: "tooshort", password: "brandnewsecret" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    await expect(
      authController.resetPassword({ body: { token, password: "short" } } as Request, mockRes())
    ).rejects.toThrow();
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });
});
