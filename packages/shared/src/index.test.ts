import { describe, expect, it } from "vitest";
import {
  abTestConfigSchema,
  applyVariables,
  campaignRecurrenceSchema,
  campaignSchema,
  campaignScheduleSchema,
  campaignUpdateSchema,
  contactActivityQuerySchema,
  contactListSchema,
  contactListUpdateSchema,
  contactSchema,
  createListFromSegmentSchema,
  cronExpressionSchema,
  csvImportSchema,
  compileSegmentRules,
  segmentFilterSchema,
  segmentSchema,
  domainThrottleSchema,
  suppressionCreateSchema,
  suppressionPolicySchema,
  emailAddressSchema,
  emailDraftSchema,
  emailDraftUpdateSchema,
  emailPreviewSchema,
  extractVariables,
  isValidCron,
  isValidTimezone,
  loginSchema,
  manualEmailSendSchema,
  nextCronRun,
  organizationSchema,
  outboundWebhookEventNameSchema,
  refreshSchema,
  registerSchema,
  resolveVariableData,
  sendEmailSchema,
  smtpConnectionSchema,
  smtpConnectionUpdateSchema,
  templateSchema,
  timezoneSchema,
  webhookEndpointSchema,
  webhookEndpointUpdateSchema
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

describe("nextCronRun", () => {
  it("returns the next fire time for a valid expression", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = nextCronRun("0 12 * * *", "UTC", from);
    expect(next).toBeInstanceOf(Date);
    expect(next?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("defaults to UTC when timezone is null/undefined", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(nextCronRun("0 0 * * *", null, from)).toBeInstanceOf(Date);
    expect(nextCronRun("0 0 * * *", undefined, from)).toBeInstanceOf(Date);
  });

  it("returns null for an invalid cron expression", () => {
    expect(nextCronRun("not-a-cron", "UTC")).toBeNull();
  });

  it("returns null for an invalid timezone", () => {
    expect(nextCronRun("0 0 * * *", "Not/AZone")).toBeNull();
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

  it("accepts tags", () => {
    const result = contactSchema.parse({
      organizationId: "org_1",
      email: "a@b.com",
      tags: ["vip", "newsletter"]
    });
    expect(result.tags).toEqual(["vip", "newsletter"]);
  });
});

describe("contactList schemas", () => {
  it("accepts a list with contactIds and a description", () => {
    expect(
      contactListSchema.safeParse({
        organizationId: "org_1",
        name: "List",
        description: "VIP customers",
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

  it("accepts optional mjml source", () => {
    const result = templateSchema.parse({
      organizationId: "org_1",
      name: "T",
      subject: "Hi",
      html: "<p>hi</p>",
      mjml: "<mjml><mj-body /></mjml>"
    });
    expect(result.mjml).toBe("<mjml><mj-body /></mjml>");
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

  it("accepts cc, bcc and replyTo with valid addresses", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        cc: ["c1@b.com", "c2@b.com"],
        bcc: ["b1@b.com"],
        replyTo: "reply@b.com",
        subject: "Hi",
        text: "Body"
      }).success
    ).toBe(true);
  });

  it("treats cc, bcc and replyTo as optional (backward compatible)", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        subject: "Hi",
        text: "Body"
      }).success
    ).toBe(true);
  });

  it("rejects an invalid cc address", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        cc: ["nope"]
      }).success
    ).toBe(false);
  });

  it("rejects an invalid bcc address", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        bcc: ["also-nope"]
      }).success
    ).toBe(false);
  });

  it("rejects an invalid replyTo address", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        replyTo: "not-an-email"
      }).success
    ).toBe(false);
  });

  it("accepts optional attachment ids", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        attachmentIds: ["att_1"]
      }).success
    ).toBe(true);
  });
});

describe("webhook endpoint schemas", () => {
  it("accepts supported outbound webhook events", () => {
    expect(outboundWebhookEventNameSchema.parse("email.delivered")).toBe(
      "email.delivered"
    );
    expect(outboundWebhookEventNameSchema.safeParse("email.unknown").success).toBe(
      false
    );
  });

  it("accepts a valid webhook endpoint", () => {
    expect(
      webhookEndpointSchema.safeParse({
        organizationId: "org_1",
        name: "Production webhook",
        url: "https://example.com/webhooks/qqueue",
        events: ["email.sent", "email.failed"],
        enabled: true
      }).success
    ).toBe(true);
  });

  it("rejects empty webhook endpoint updates", () => {
    expect(webhookEndpointUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts partial webhook endpoint updates", () => {
    expect(
      webhookEndpointUpdateSchema.safeParse({
        events: ["email.opened"]
      }).success
    ).toBe(true);
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

describe("manualEmailSendSchema", () => {
  const base = {
    organizationId: "org_1",
    subject: "Hello",
    html: "<p>Hi</p>"
  };

  it("accepts manually typed To recipients", () => {
    expect(
      manualEmailSendSchema.safeParse({ ...base, to: ["a@x.com"] }).success
    ).toBe(true);
  });

  it("accepts a send addressed only by contact list", () => {
    expect(
      manualEmailSendSchema.safeParse({ ...base, listIds: ["list_1"] }).success
    ).toBe(true);
  });

  it("accepts contact selection", () => {
    expect(
      manualEmailSendSchema.safeParse({ ...base, contactIds: ["c1"] }).success
    ).toBe(true);
  });

  it("rejects a send with no recipients", () => {
    expect(manualEmailSendSchema.safeParse(base).success).toBe(false);
  });

  it("rejects invalid To addresses", () => {
    expect(
      manualEmailSendSchema.safeParse({ ...base, to: ["not-an-email"] }).success
    ).toBe(false);
  });

  it("requires a body (html or text)", () => {
    expect(
      manualEmailSendSchema.safeParse({
        organizationId: "org_1",
        subject: "Hi",
        to: ["a@x.com"]
      }).success
    ).toBe(false);
  });

  it("supports cc and bcc", () => {
    expect(
      manualEmailSendSchema.safeParse({
        ...base,
        to: ["a@x.com"],
        cc: ["cc@x.com"],
        bcc: ["bcc@x.com"]
      }).success
    ).toBe(true);
  });

  it("accepts attachment ids", () => {
    expect(
      manualEmailSendSchema.safeParse({
        ...base,
        to: ["a@x.com"],
        attachmentIds: ["att_1", "att_2"]
      }).success
    ).toBe(true);
  });

  it("rejects empty attachment ids", () => {
    expect(
      manualEmailSendSchema.safeParse({
        ...base,
        to: ["a@x.com"],
        attachmentIds: [""]
      }).success
    ).toBe(false);
  });
});

describe("emailPreviewSchema", () => {
  it("allows a fully empty preview (besides the org id)", () => {
    expect(
      emailPreviewSchema.safeParse({ organizationId: "org_1" }).success
    ).toBe(true);
  });
});

describe("segmentFilterSchema", () => {
  it("defaults match to ANY and requires at least one tag", () => {
    const parsed = segmentFilterSchema.safeParse({
      organizationId: "org_1",
      tags: ["vip"]
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.match).toBe("ANY");
  });

  it("rejects an empty tag list", () => {
    expect(
      segmentFilterSchema.safeParse({ organizationId: "org_1", tags: [] })
        .success
    ).toBe(false);
  });

  it("accepts ALL match and an optional status filter", () => {
    expect(
      segmentFilterSchema.safeParse({
        organizationId: "org_1",
        tags: ["a", "b"],
        match: "ALL",
        status: "ACTIVE"
      }).success
    ).toBe(true);
  });
});

describe("createListFromSegmentSchema", () => {
  it("requires a list name on top of the filter", () => {
    expect(
      createListFromSegmentSchema.safeParse({
        organizationId: "org_1",
        tags: ["vip"]
      }).success
    ).toBe(false);
    expect(
      createListFromSegmentSchema.safeParse({
        organizationId: "org_1",
        tags: ["vip"],
        name: "VIPs"
      }).success
    ).toBe(true);
  });
});

describe("csvImportSchema", () => {
  it("allows an optional target list", () => {
    expect(
      csvImportSchema.safeParse({ organizationId: "org_1" }).success
    ).toBe(true);
    expect(
      csvImportSchema.safeParse({
        organizationId: "org_1",
        contactListId: "list_1"
      }).success
    ).toBe(true);
  });
});

describe("suppressionCreateSchema", () => {
  it("defaults reason to MANUAL and validates the email", () => {
    const parsed = suppressionCreateSchema.safeParse({
      organizationId: "org_1",
      email: "blocked@example.com"
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reason).toBe("MANUAL");
    expect(
      suppressionCreateSchema.safeParse({
        organizationId: "org_1",
        email: "not-an-email"
      }).success
    ).toBe(false);
  });
});

describe("suppressionPolicySchema", () => {
  it("accepts in-range threshold and window", () => {
    const parsed = suppressionPolicySchema.safeParse({
      organizationId: "org_1",
      softBounceThreshold: 3,
      softBounceWindowDays: 30
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects out-of-range or non-integer values", () => {
    expect(
      suppressionPolicySchema.safeParse({
        organizationId: "org_1",
        softBounceThreshold: 0,
        softBounceWindowDays: 30
      }).success
    ).toBe(false);
    expect(
      suppressionPolicySchema.safeParse({
        organizationId: "org_1",
        softBounceThreshold: 3,
        softBounceWindowDays: 400
      }).success
    ).toBe(false);
  });
});

describe("domainThrottleSchema", () => {
  it("accepts a bare domain and a positive cap, lowercasing the domain", () => {
    const parsed = domainThrottleSchema.safeParse({
      organizationId: "org_1",
      domain: "Gmail.com",
      maxPerMinute: 30
    });
    expect(parsed.success && parsed.data.domain).toBe("gmail.com");
  });

  it("defaults the domain to '' (the org-wide default cap)", () => {
    const parsed = domainThrottleSchema.safeParse({
      organizationId: "org_1",
      maxPerMinute: 30
    });
    expect(parsed.success && parsed.data.domain).toBe("");
  });

  it("rejects an invalid domain or a non-positive cap", () => {
    expect(
      domainThrottleSchema.safeParse({
        organizationId: "org_1",
        domain: "not a domain",
        maxPerMinute: 30
      }).success
    ).toBe(false);
    expect(
      domainThrottleSchema.safeParse({
        organizationId: "org_1",
        domain: "gmail.com",
        maxPerMinute: 0
      }).success
    ).toBe(false);
  });
});

describe("segmentRuleSchema + compileSegmentRules", () => {
  it("compiles tag matches (ANY/ALL/NONE)", () => {
    expect(
      compileSegmentRules({ field: "tags", match: "ANY", values: ["a", "b"] })
    ).toEqual({ tags: { hasSome: ["a", "b"] } });
    expect(
      compileSegmentRules({ field: "tags", match: "ALL", values: ["a"] })
    ).toEqual({ tags: { hasEvery: ["a"] } });
    expect(
      compileSegmentRules({ field: "tags", match: "NONE", values: ["a"] })
    ).toEqual({ NOT: { tags: { hasSome: ["a"] } } });
  });

  it("compiles status, emailDomain and createdAt leaves", () => {
    expect(compileSegmentRules({ field: "status", eq: "ACTIVE" })).toEqual({
      status: "ACTIVE"
    });
    expect(
      compileSegmentRules({ field: "emailDomain", eq: "Gmail.com" })
    ).toEqual({ email: { endsWith: "@gmail.com", mode: "insensitive" } });
    expect(
      compileSegmentRules({
        field: "createdAt",
        after: "2026-01-01T00:00:00.000Z"
      })
    ).toEqual({ createdAt: { gte: "2026-01-01T00:00:00.000Z" } });
  });

  it("compiles nested AND/OR groups", () => {
    const compiled = compileSegmentRules({
      op: "AND",
      rules: [
        { field: "status", eq: "ACTIVE" },
        {
          op: "OR",
          rules: [
            { field: "tags", match: "ANY", values: ["vip"] },
            { field: "emailDomain", eq: "example.com" }
          ]
        }
      ]
    });
    expect(compiled).toEqual({
      AND: [
        { status: "ACTIVE" },
        {
          OR: [
            { tags: { hasSome: ["vip"] } },
            { email: { endsWith: "@example.com", mode: "insensitive" } }
          ]
        }
      ]
    });
  });

  it("accepts a valid rule tree and rejects an unknown field", () => {
    expect(
      segmentSchema.safeParse({
        organizationId: "org_1",
        name: "VIPs",
        rules: { field: "tags", match: "ANY", values: ["vip"] }
      }).success
    ).toBe(true);
    expect(
      segmentSchema.safeParse({
        organizationId: "org_1",
        name: "Bad",
        rules: { field: "unknown", eq: "x" }
      }).success
    ).toBe(false);
  });

  it("rejects a rule tree nested too deeply", () => {
    let rule: unknown = { field: "status", eq: "ACTIVE" };
    for (let i = 0; i < 6; i += 1) {
      rule = { op: "AND", rules: [rule] };
    }
    expect(
      segmentSchema.safeParse({
        organizationId: "org_1",
        name: "Deep",
        rules: rule
      }).success
    ).toBe(false);
  });
});

describe("campaignSchema target exclusivity", () => {
  it("rejects setting both contactListId and segmentId", () => {
    expect(
      campaignSchema.safeParse({
        organizationId: "org_1",
        name: "C",
        contactListId: "l1",
        segmentId: "s1"
      }).success
    ).toBe(false);
  });

  it("accepts a segment-only target", () => {
    expect(
      campaignSchema.safeParse({
        organizationId: "org_1",
        name: "C",
        segmentId: "s1"
      }).success
    ).toBe(true);
  });
});

describe("abTestConfigSchema", () => {
  it("accepts a full enabled config with >= 2 variants", () => {
    expect(
      abTestConfigSchema.safeParse({
        enabled: true,
        percent: 20,
        metric: "OPEN",
        windowMin: 60,
        variants: [
          { label: "A", subject: "One" },
          { label: "B", subject: "Two" }
        ]
      }).success
    ).toBe(true);
  });

  it("accepts a disable payload with no other fields", () => {
    expect(abTestConfigSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it("rejects enabling without required fields or with one variant", () => {
    expect(
      abTestConfigSchema.safeParse({ enabled: true, percent: 20 }).success
    ).toBe(false);
    expect(
      abTestConfigSchema.safeParse({
        enabled: true,
        percent: 20,
        metric: "OPEN",
        windowMin: 60,
        variants: [{ label: "A", subject: "One" }]
      }).success
    ).toBe(false);
    // percent capped at 50.
    expect(
      abTestConfigSchema.safeParse({
        enabled: true,
        percent: 80,
        metric: "OPEN",
        windowMin: 60,
        variants: [
          { label: "A", subject: "One" },
          { label: "B", subject: "Two" }
        ]
      }).success
    ).toBe(false);
  });

  it("flags each missing required field when enabled", () => {
    const result = abTestConfigSchema.safeParse({ enabled: true });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("percent");
    expect(paths).toContain("metric");
    expect(paths).toContain("windowMin");
    expect(paths).toContain("variants");
  });
});

describe("extractVariables", () => {
  it("collects distinct tokens across sources in first-seen order", () => {
    expect(
      extractVariables("Hi {{name}}", "{{name}} — order {{id}}", "{{id}}")
    ).toEqual(["name", "id"]);
  });

  it("ignores null/undefined/empty sources and returns [] when none match", () => {
    expect(extractVariables(null, undefined, "", "no tokens here")).toEqual([]);
  });
});

describe("applyVariables", () => {
  it("returns an empty string for null/undefined/empty input", () => {
    expect(applyVariables(null, { a: "x" })).toBe("");
    expect(applyVariables(undefined, { a: "x" })).toBe("");
    expect(applyVariables("", { a: "x" })).toBe("");
  });

  it("returns the value unchanged when no data is supplied", () => {
    expect(applyVariables("Hi {{name}}", undefined)).toBe("Hi {{name}}");
  });

  it("substitutes known tokens with their values", () => {
    expect(applyVariables("Hi {{name}}, order {{id}}", { name: "Ada", id: 42 })).toBe(
      "Hi Ada, order 42"
    );
  });

  it("renders unknown, undefined, or null values as empty strings", () => {
    expect(
      applyVariables("[{{missing}}][{{u}}][{{n}}]", { u: undefined, n: null })
    ).toBe("[][][]");
  });
});

describe("resolveVariableData", () => {
  it("seeds the map from declared defaults", () => {
    expect(
      resolveVariableData([{ name: "greeting", defaultValue: "Hello" }], undefined)
    ).toEqual({ greeting: "Hello" });
  });

  it("skips declared variables with null or empty defaults", () => {
    expect(
      resolveVariableData(
        [
          { name: "a", defaultValue: "" },
          { name: "b", defaultValue: null },
          { name: "c" }
        ],
        undefined
      )
    ).toEqual({});
  });

  it("lets non-empty caller data override defaults", () => {
    expect(
      resolveVariableData([{ name: "name", defaultValue: "Friend" }], {
        name: "Ada"
      })
    ).toEqual({ name: "Ada" });
  });

  it("falls back to the default when the override is empty", () => {
    expect(
      resolveVariableData([{ name: "name", defaultValue: "Friend" }], { name: "" })
    ).toEqual({ name: "Friend" });
  });

  it("handles null variables and data without throwing", () => {
    expect(resolveVariableData(null, undefined)).toEqual({});
  });
});

describe("contactActivityQuerySchema", () => {
  it("defaults and clamps the limit", () => {
    const parsed = contactActivityQuerySchema.safeParse({});
    expect(parsed.success && parsed.data.limit).toBe(50);
    expect(contactActivityQuerySchema.safeParse({ limit: 0 }).success).toBe(
      false
    );
    expect(contactActivityQuerySchema.safeParse({ limit: 1000 }).success).toBe(
      false
    );
  });

  it("coerces a string limit from the query string", () => {
    const parsed = contactActivityQuerySchema.safeParse({ limit: "25" });
    expect(parsed.success && parsed.data.limit).toBe(25);
  });
});

describe("emailDraftSchema", () => {
  it("permits an empty in-progress draft", () => {
    expect(emailDraftSchema.safeParse({ organizationId: "org_1" }).success).toBe(
      true
    );
  });

  it("accepts unvalidated recipient strings for partial drafts", () => {
    expect(
      emailDraftSchema.safeParse({
        organizationId: "org_1",
        to: ["half-typed"]
      }).success
    ).toBe(true);
  });

  it("allows partial updates without an organization id", () => {
    expect(
      emailDraftUpdateSchema.safeParse({ subject: "Updated" }).success
    ).toBe(true);
  });
});
