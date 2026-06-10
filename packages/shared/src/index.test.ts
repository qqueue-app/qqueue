import { describe, expect, it } from "vitest";
import {
  campaignRecurrenceSchema,
  campaignSchema,
  campaignScheduleSchema,
  campaignUpdateSchema,
  contactListSchema,
  contactListUpdateSchema,
  contactSchema,
  cronExpressionSchema,
  emailAddressSchema,
  isValidCron,
  isValidTimezone,
  loginSchema,
  organizationSchema,
  refreshSchema,
  registerSchema,
  sendEmailSchema,
  smtpConnectionSchema,
  smtpConnectionUpdateSchema,
  templateSchema,
  timezoneSchema
} from "./index.js";

describe("isValidCron", () => {
  it("accepts a valid 5-field cron expression", () => {
    expect(isValidCron("0 9 * * 1")).toBe(true);
  });

  it("accepts a valid 6-field cron expression", () => {
    expect(isValidCron("0 0 9 * * 1")).toBe(true);
  });

  it("rejects an unparseable expression", () => {
    expect(isValidCron("not a cron")).toBe(false);
  });
});

describe("isValidTimezone", () => {
  it("accepts a known IANA timezone", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
  });

  it("rejects an unknown timezone", () => {
    expect(isValidTimezone("Mars/Phobos")).toBe(false);
  });
});

describe("emailAddressSchema", () => {
  it("accepts a valid email", () => {
    expect(emailAddressSchema.parse("a@b.com")).toBe("a@b.com");
  });

  it("rejects an invalid email", () => {
    expect(emailAddressSchema.safeParse("nope").success).toBe(false);
  });
});

describe("registerSchema", () => {
  it("accepts minimal valid input", () => {
    const result = registerSchema.parse({
      email: "a@b.com",
      password: "password123"
    });
    expect(result.email).toBe("a@b.com");
  });

  it("rejects short passwords", () => {
    expect(
      registerSchema.safeParse({ email: "a@b.com", password: "short" }).success
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts a non-empty password", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.com", password: "x" }).success
    ).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.com", password: "" }).success
    ).toBe(false);
  });
});

describe("refreshSchema", () => {
  it("requires a refreshToken", () => {
    expect(refreshSchema.safeParse({ refreshToken: "" }).success).toBe(false);
    expect(refreshSchema.safeParse({ refreshToken: "t" }).success).toBe(true);
  });
});

describe("organizationSchema", () => {
  it("requires a non-empty name", () => {
    expect(organizationSchema.safeParse({ name: "" }).success).toBe(false);
    expect(organizationSchema.safeParse({ name: "Acme" }).success).toBe(true);
  });
});

describe("contactSchema", () => {
  it("accepts a valid contact with metadata", () => {
    const result = contactSchema.parse({
      organizationId: "org_1",
      email: "a@b.com",
      firstName: "A",
      lastName: "B",
      metadata: { tier: "gold" }
    });
    expect(result.organizationId).toBe("org_1");
  });

  it("rejects a missing organizationId", () => {
    expect(
      contactSchema.safeParse({ organizationId: "", email: "a@b.com" }).success
    ).toBe(false);
  });
});

describe("contactList schemas", () => {
  it("accepts a list with contactIds", () => {
    expect(
      contactListSchema.safeParse({
        organizationId: "org_1",
        name: "List",
        contactIds: ["c1", "c2"]
      }).success
    ).toBe(true);
  });

  it("allows partial updates", () => {
    expect(contactListUpdateSchema.safeParse({}).success).toBe(true);
    expect(
      contactListUpdateSchema.safeParse({ name: "New" }).success
    ).toBe(true);
  });
});

describe("templateSchema", () => {
  it("requires subject and html", () => {
    expect(
      templateSchema.safeParse({
        organizationId: "org_1",
        name: "T",
        subject: "",
        html: "<p>hi</p>"
      }).success
    ).toBe(false);
  });
});

describe("campaign schemas", () => {
  it("accepts a valid campaign", () => {
    expect(
      campaignSchema.safeParse({
        organizationId: "org_1",
        name: "Spring",
        scheduledAt: "2026-01-01T00:00:00.000Z"
      }).success
    ).toBe(true);
  });

  it("rejects a bad scheduledAt", () => {
    expect(
      campaignSchema.safeParse({
        organizationId: "org_1",
        name: "Spring",
        scheduledAt: "not-a-date"
      }).success
    ).toBe(false);
  });

  it("omits organizationId from the update schema", () => {
    const result = campaignUpdateSchema.parse({ name: "Renamed" });
    expect(result).toEqual({ name: "Renamed" });
  });

  it("requires a datetime for the schedule schema", () => {
    expect(
      campaignScheduleSchema.safeParse({ scheduledAt: "nope" }).success
    ).toBe(false);
  });
});

describe("cron and timezone schemas", () => {
  it("validates cron expressions via refine", () => {
    expect(cronExpressionSchema.safeParse("0 9 * * 1").success).toBe(true);
    expect(cronExpressionSchema.safeParse("bad").success).toBe(false);
  });

  it("validates timezones via refine", () => {
    expect(timezoneSchema.safeParse("UTC").success).toBe(true);
    expect(timezoneSchema.safeParse("Nowhere/Nope").success).toBe(false);
  });

  it("validates the combined recurrence schema", () => {
    expect(
      campaignRecurrenceSchema.safeParse({
        cronExpression: "0 9 * * 1",
        timezone: "UTC"
      }).success
    ).toBe(true);
  });
});

describe("sendEmailSchema", () => {
  it("accepts a template-based send", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        templateId: "tpl_1",
        variables: { name: "A" }
      }).success
    ).toBe(true);
  });

  it("rejects an invalid recipient", () => {
    expect(
      sendEmailSchema.safeParse({ organizationId: "org_1", to: "nope" }).success
    ).toBe(false);
  });
});

describe("smtpConnection schemas", () => {
  it("accepts a full connection", () => {
    expect(
      smtpConnectionSchema.safeParse({
        organizationId: "org_1",
        name: "Primary",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "user",
        password: "pass",
        fromEmail: "from@example.com"
      }).success
    ).toBe(true);
  });

  it("rejects a non-positive port", () => {
    expect(
      smtpConnectionSchema.safeParse({
        organizationId: "org_1",
        name: "Primary",
        host: "smtp.example.com",
        port: 0,
        secure: false,
        username: "user",
        password: "pass",
        fromEmail: "from@example.com"
      }).success
    ).toBe(false);
  });

  it("allows partial updates", () => {
    expect(smtpConnectionUpdateSchema.safeParse({ port: 25 }).success).toBe(
      true
    );
  });
});
