import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "./test/prisma-mock.js";
import { createAuthTokens } from "./lib/tokens.js";
import { signTrackingToken } from "@qqueue/email-engine";

// Heavy/external modules pulled in transitively by the v1 router.
vi.mock("./queues/campaign-processing.queue.js", () => ({
  campaignProcessingQueue: {
    add: vi.fn().mockResolvedValue(undefined),
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined)
  }
}));
vi.mock("./queues/email-sending.queue.js", () => ({
  emailSendingQueue: { add: vi.fn().mockResolvedValue(undefined) }
}));

const { createApp } = await import("./app.js");

const app = createApp();
const { accessToken } = createAuthTokens({ id: "user_1", email: "a@b.com" });
const auth = `Bearer ${accessToken}`;

beforeEach(() => {
  // Default: user_1 is an OWNER of org_1 (used by requireOrgMembership).
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER"
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("health + cors + json", () => {
  it("responds to /health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("auth routes", () => {
  it("registers a user (201)", async () => {
    prismaMock.user.create.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A",
      createdAt: new Date(0)
    } as never);
    prismaMock.organization.create.mockResolvedValue({
      id: "org_1",
      name: "Acme"
    } as never);

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "a@b.com", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.data.tokens.accessToken).toEqual(expect.any(String));
  });

  it("returns 400 (ZodError) for an invalid register body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Invalid request body");
  });

  it("returns 401 for a bad login", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@b.com", password: "whatever" });
    expect(res.status).toBe(401);
  });
});

describe("requireAuth on protected routes", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await request(app).get("/api/v1/organizations");
    expect(res.status).toBe(401);
  });

  it("lists organizations with a valid token", async () => {
    prismaMock.organizationMember.findMany.mockResolvedValue([] as never);
    const res = await request(app)
      .get("/api/v1/organizations")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});

describe("organizations controller", () => {
  it("returns 404 when the org is not found", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/organizations/org_1")
      .set("Authorization", auth);
    expect(res.status).toBe(404);
  });

  it("creates an organization (201)", async () => {
    prismaMock.organization.create.mockResolvedValue({
      id: "org_1",
      name: "Acme"
    } as never);
    const res = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", auth)
      .send({ name: "Acme" });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe("OWNER");
  });

  it("deletes an organization (204)", async () => {
    prismaMock.organization.delete.mockResolvedValue({ id: "org_1" } as never);
    const res = await request(app)
      .delete("/api/v1/organizations/org_1")
      .set("Authorization", auth);
    expect(res.status).toBe(204);
  });
});

describe("requireOrgMembership", () => {
  it("returns 400 when organizationId is missing", async () => {
    const res = await request(app)
      .get("/api/v1/contacts")
      .set("Authorization", auth);
    expect(res.status).toBe(400);
  });

  it("returns 403 when the user is not a member", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/contacts?organizationId=org_1")
      .set("Authorization", auth);
    expect(res.status).toBe(403);
  });
});

describe("contacts routes", () => {
  it("lists contacts", async () => {
    prismaMock.contact.findMany.mockResolvedValue([] as never);
    const res = await request(app)
      .get("/api/v1/contacts?organizationId=org_1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });

  it("creates a contact (201)", async () => {
    prismaMock.contact.create.mockResolvedValue({ id: "c1" } as never);
    const res = await request(app)
      .post("/api/v1/contacts")
      .set("Authorization", auth)
      .send({ organizationId: "org_1", email: "x@y.com" });
    expect(res.status).toBe(201);
  });

  it("returns 404 for a missing contact (controller branch)", async () => {
    prismaMock.contact.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/contacts/c1")
      .set("Authorization", auth);
    expect(res.status).toBe(404);
  });

  it("returns a contact when found", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({ id: "c1" } as never);
    const res = await request(app)
      .get("/api/v1/contacts/c1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: "c1" });
  });

  it("deletes a contact (204)", async () => {
    prismaMock.contact.deleteMany.mockResolvedValue({ count: 1 } as never);
    const res = await request(app)
      .delete("/api/v1/contacts/c1")
      .set("Authorization", auth);
    expect(res.status).toBe(204);
  });
});

describe("templates routes", () => {
  it("returns 404 for a missing template", async () => {
    prismaMock.template.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/templates/t1")
      .set("Authorization", auth);
    expect(res.status).toBe(404);
  });

  it("updates a template", async () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: "t1" } as never);
    prismaMock.template.update.mockResolvedValue({ id: "t1" } as never);
    const res = await request(app)
      .put("/api/v1/templates/t1")
      .set("Authorization", auth)
      .send({
        organizationId: "org_1",
        name: "N",
        subject: "S",
        html: "<p>H</p>"
      });
    expect(res.status).toBe(200);
  });
});

describe("contact-lists routes", () => {
  it("returns 404 for a missing list", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/contact-lists/l1")
      .set("Authorization", auth);
    expect(res.status).toBe(404);
  });

  it("creates a list (201)", async () => {
    prismaMock.contactList.create.mockResolvedValue({ id: "l1" } as never);
    const res = await request(app)
      .post("/api/v1/contact-lists")
      .set("Authorization", auth)
      .send({ organizationId: "org_1", name: "List" });
    expect(res.status).toBe(201);
  });
});

describe("dashboard route", () => {
  it("returns the summary", async () => {
    prismaMock.sMTPConnection.count.mockResolvedValue(0 as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    prismaMock.contact.count.mockResolvedValue(0 as never);
    prismaMock.template.count.mockResolvedValue(0 as never);
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);
    prismaMock.emailEvent.findMany.mockResolvedValue([] as never);

    const res = await request(app)
      .get("/api/v1/dashboard/summary?organizationId=org_1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.data.counts.smtpConnections).toBe(0);
  });
});

describe("campaigns routes", () => {
  it("lists campaigns", async () => {
    prismaMock.campaign.findMany.mockResolvedValue([] as never);
    const res = await request(app)
      .get("/api/v1/campaigns?organizationId=org_1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });

  it("returns 404 for a missing campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/campaigns/c1")
      .set("Authorization", auth);
    expect(res.status).toBe(404);
  });

  it("returns a campaign when found", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({ id: "c1" } as never);
    const res = await request(app)
      .get("/api/v1/campaigns/c1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });
});

describe("smtp-connections routes", () => {
  it("returns 404 for a missing connection", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/smtp-connections/s1")
      .set("Authorization", auth);
    expect(res.status).toBe(404);
  });
});

describe("tracking routes (public)", () => {
  it("always returns the pixel for the open endpoint", async () => {
    const token = signTrackingToken({ j: "job_1" }, "test-tracking-secret");
    prismaMock.emailJob.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/v1/track/open/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/gif");
  });

  it("returns the pixel even for an invalid open token", async () => {
    const res = await request(app).get("/api/v1/track/open/bad.token");
    expect(res.status).toBe(200);
  });

  it("redirects (302) for a valid click token", async () => {
    const token = signTrackingToken(
      { j: "job_1", u: "https://example.com" },
      "test-tracking-secret"
    );
    prismaMock.emailJob.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/v1/track/click/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com");
  });

  it("returns 400 for a click token with no/invalid url", async () => {
    const token = signTrackingToken(
      { j: "job_1", u: "javascript:alert(1)" } as never,
      "test-tracking-secret"
    );
    const res = await request(app).get(`/api/v1/track/click/${token}`);
    expect(res.status).toBe(400);
  });

  it("rejects a webhook with the wrong secret (401)", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/email-events")
      .send({ type: "DELIVERED", emailJobId: "job_1" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when no email job matches the webhook", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/v1/webhooks/email-events")
      .set("x-webhook-secret", "test-webhook-secret")
      .send({ type: "DELIVERED", emailJobId: "missing" });
    expect(res.status).toBe(404);
  });

  it("accepts a valid webhook (202)", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      id: "job_1",
      organizationId: "org_1",
      toEmail: "x@y.com"
    } as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    const res = await request(app)
      .post("/api/v1/webhooks/email-events")
      .set("x-webhook-secret", "test-webhook-secret")
      .send({ type: "DELIVERED", emailJobId: "job_1" });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ recorded: true });
  });
});

describe("error-handler integration", () => {
  it("maps a Prisma P2025 thrown in a handler to 404", async () => {
    const { PrismaClientKnownRequestError } = await import(
      "@prisma/client/runtime/library"
    );
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.organization.update.mockRejectedValue(
      new PrismaClientKnownRequestError("nope", {
        code: "P2025",
        clientVersion: "6.0.0"
      })
    );
    const res = await request(app)
      .put("/api/v1/organizations/org_1")
      .set("Authorization", auth)
      .send({ name: "New" });
    expect(res.status).toBe(404);
  });
});

describe("auth login/refresh success", () => {
  it("logs in successfully", async () => {
    const { hashPassword } = await import("./lib/crypto.js");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A",
      passwordHash: await hashPassword("password123"),
      createdAt: new Date(0),
      members: []
    } as never);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@b.com", password: "password123" });
    expect(res.status).toBe(200);
  });

  it("refreshes tokens", async () => {
    const { refreshToken } = createAuthTokens({ id: "user_1", email: "a@b.com" });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com"
    } as never);
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken });
    expect(res.status).toBe(200);
  });
});

describe("campaigns mutations", () => {
  const owned = {
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

  it("creates a campaign (201)", async () => {
    prismaMock.campaign.create.mockResolvedValue(owned as never);
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", auth)
      .send({ organizationId: "org_1", name: "Camp" });
    expect(res.status).toBe(201);
  });

  it("updates a draft campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(owned as never);
    prismaMock.campaign.update.mockResolvedValue(owned as never);
    const res = await request(app)
      .put("/api/v1/campaigns/c1")
      .set("Authorization", auth)
      .send({ name: "New" });
    expect(res.status).toBe(200);
  });

  it("duplicates a campaign (201)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(owned as never);
    prismaMock.campaign.create.mockResolvedValue(owned as never);
    const res = await request(app)
      .post("/api/v1/campaigns/c1/duplicate")
      .set("Authorization", auth);
    expect(res.status).toBe(201);
  });

  it("deletes a campaign (204)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(owned as never);
    prismaMock.campaign.delete.mockResolvedValue(owned as never);
    const res = await request(app)
      .delete("/api/v1/campaigns/c1")
      .set("Authorization", auth);
    expect(res.status).toBe(204);
  });

  it("sends a campaign now", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(owned as never);
    prismaMock.campaign.update.mockResolvedValue(owned as never);
    const res = await request(app)
      .post("/api/v1/campaigns/c1/send")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });

  it("schedules a campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(owned as never);
    prismaMock.campaign.update.mockResolvedValue(owned as never);
    const res = await request(app)
      .post("/api/v1/campaigns/c1/schedule")
      .set("Authorization", auth)
      .send({ scheduledAt: "2999-01-01T00:00:00.000Z" });
    expect(res.status).toBe(200);
  });

  it("sets recurrence", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(owned as never);
    prismaMock.campaign.update.mockResolvedValue(owned as never);
    const res = await request(app)
      .post("/api/v1/campaigns/c1/recurrence")
      .set("Authorization", auth)
      .send({ cronExpression: "0 0 * * *", timezone: "UTC" });
    expect(res.status).toBe(200);
  });

  it("pauses and resumes a campaign", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      ...owned,
      status: "SCHEDULED"
    } as never);
    prismaMock.campaign.update.mockResolvedValue(owned as never);
    const pauseRes = await request(app)
      .post("/api/v1/campaigns/c1/pause")
      .set("Authorization", auth);
    expect(pauseRes.status).toBe(200);

    prismaMock.campaign.findFirst.mockResolvedValue({
      ...owned,
      status: "PAUSED",
      scheduledAt: new Date("2000-01-01T00:00:00.000Z")
    } as never);
    const resumeRes = await request(app)
      .post("/api/v1/campaigns/c1/resume")
      .set("Authorization", auth);
    expect(resumeRes.status).toBe(200);
  });

  it("returns campaign analytics", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(owned as never);
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.emailEvent.groupBy.mockResolvedValue([] as never);
    prismaMock.emailEvent.findMany.mockResolvedValue([] as never);
    const res = await request(app)
      .get("/api/v1/campaigns/c1/analytics")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });
});

describe("smtp-connections mutations", () => {
  it("returns a connection when found", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "s1" } as never);
    prismaMock.sMTPConnection.findUnique.mockResolvedValue({ id: "s1" } as never);
    const res = await request(app)
      .get("/api/v1/smtp-connections/s1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });

  it("deletes a connection (204)", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "s1" } as never);
    prismaMock.sMTPConnection.delete.mockResolvedValue({ id: "s1" } as never);
    const res = await request(app)
      .delete("/api/v1/smtp-connections/s1")
      .set("Authorization", auth);
    expect(res.status).toBe(204);
  });
});

describe("templates mutations", () => {
  it("creates a template (201)", async () => {
    prismaMock.template.create.mockResolvedValue({ id: "t1" } as never);
    const res = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", auth)
      .send({
        organizationId: "org_1",
        name: "N",
        subject: "S",
        html: "<p>H</p>"
      });
    expect(res.status).toBe(201);
  });

  it("returns a template when found", async () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: "t1" } as never);
    const res = await request(app)
      .get("/api/v1/templates/t1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });

  it("deletes a template (204)", async () => {
    prismaMock.template.deleteMany.mockResolvedValue({ count: 1 } as never);
    const res = await request(app)
      .delete("/api/v1/templates/t1")
      .set("Authorization", auth);
    expect(res.status).toBe(204);
  });
});

describe("contact-lists mutations", () => {
  it("returns a list when found", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({ id: "l1" } as never);
    const res = await request(app)
      .get("/api/v1/contact-lists/l1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });

  it("updates a list", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({
      id: "l1",
      organizationId: "org_1"
    } as never);
    prismaMock.contactList.update.mockResolvedValue({ id: "l1" } as never);
    const res = await request(app)
      .put("/api/v1/contact-lists/l1")
      .set("Authorization", auth)
      .send({ name: "New" });
    expect(res.status).toBe(200);
  });

  it("deletes a list (204)", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({ id: "l1" } as never);
    prismaMock.contactList.delete.mockResolvedValue({ id: "l1" } as never);
    const res = await request(app)
      .delete("/api/v1/contact-lists/l1")
      .set("Authorization", auth);
    expect(res.status).toBe(204);
  });
});

describe("contacts update", () => {
  it("updates a contact", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({ id: "c1" } as never);
    prismaMock.contact.update.mockResolvedValue({ id: "c1" } as never);
    const res = await request(app)
      .put("/api/v1/contacts/c1")
      .set("Authorization", auth)
      .send({ organizationId: "org_1", email: "x@y.com" });
    expect(res.status).toBe(200);
  });
});

describe("organizations get/update success", () => {
  it("returns an organization when found", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.organization.findUnique.mockResolvedValue({ id: "org_1" } as never);
    const res = await request(app)
      .get("/api/v1/organizations/org_1")
      .set("Authorization", auth);
    expect(res.status).toBe(200);
  });

  it("updates an organization", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.organization.update.mockResolvedValue({ id: "org_1" } as never);
    const res = await request(app)
      .put("/api/v1/organizations/org_1")
      .set("Authorization", auth)
      .send({ name: "New" });
    expect(res.status).toBe(200);
  });
});

describe("transactional-email send", () => {
  it("queues a future email (202)", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({
      id: "smtp_1",
      organizationId: "org_1",
      fromEmail: "from@b.com",
      fromName: null
    } as never);
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);
    const res = await request(app)
      .post("/api/v1/transactional-email/send")
      .set("Authorization", auth)
      .send({
        organizationId: "org_1",
        to: "x@y.com",
        subject: "Hi",
        text: "Body",
        scheduledAt: "2999-01-01T00:00:00.000Z"
      });
    expect(res.status).toBe(202);
  });
});

describe("createApp", () => {
  it("returns a callable express app", () => {
    const built = createApp();
    expect(typeof built).toBe("function");
    expect(typeof built.use).toBe("function");
  });
});
