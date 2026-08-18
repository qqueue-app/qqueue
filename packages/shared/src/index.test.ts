import { describe, expect, it, vi } from "vitest";
import {
  abTestConfigSchema,
  applyVariables,
  base64DecodedBytes,
  campaignRecurrenceSchema,
  campaignSchema,
  campaignScheduleSchema,
  campaignUpdateSchema,
  contactActivityQuerySchema,
  contactListSchema,
  mailboxDomain,
  organizationBrandingSchema,
  resolveInboxNotify,
  deriveReputationAlerts,
  type DeliverabilityOverview,
  resolveSuppressionPolicy,
  shouldSuppressBounce,
  contactListUpdateSchema,
  contactSchema,
  createListFromSegmentSchema,
  cronExpressionSchema,
  contactBulkDeleteSchema,
  csvImportSchema,
  recurringSendCreateSchema,
  recurringSendUpdateSchema,
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
  INLINE_ATTACHMENT_MAX_BYTES,
  inlineAttachmentSchema,
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

  it("accepts a from address as a sender selector", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        from: "support@acme.com",
        subject: "Hi",
        text: "Body"
      }).success
    ).toBe(true);
  });

  it("rejects a from that is not an address", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        from: "Acme Support"
      }).success
    ).toBe(false);
  });

  it("treats from as optional, so sends without one still parse", () => {
    const parsed = sendEmailSchema.parse({
      organizationId: "org_1",
      to: "a@b.com",
      subject: "Hi",
      text: "Body"
    });
    expect(parsed.from).toBeUndefined();
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

  it("accepts inline attachments with a cid", () => {
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        subject: "Hi",
        html: '<img src="cid:qr" />',
        attachments: [
          {
            filename: "qr.png",
            contentBase64: Buffer.from("png-bytes").toString("base64"),
            contentType: "image/png",
            cid: "qr"
          }
        ]
      }).success
    ).toBe(true);
  });

  it("rejects more than the inline attachment cap", () => {
    const one = {
      filename: "a.png",
      contentBase64: Buffer.from("x").toString("base64")
    };
    expect(
      sendEmailSchema.safeParse({
        organizationId: "org_1",
        to: "a@b.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        attachments: Array.from({ length: 11 }, () => one)
      }).success
    ).toBe(false);
  });
});

describe("base64DecodedBytes", () => {
  it("computes the exact decoded size for each padding case", () => {
    // "a" → 1 byte ("=="), "ab" → 2 bytes ("="), "abc" → 3 bytes (none).
    expect(base64DecodedBytes(Buffer.from("a").toString("base64"))).toBe(1);
    expect(base64DecodedBytes(Buffer.from("ab").toString("base64"))).toBe(2);
    expect(base64DecodedBytes(Buffer.from("abc").toString("base64"))).toBe(3);
  });
});

describe("inlineAttachmentSchema", () => {
  const valid = {
    filename: "qr.png",
    contentBase64: Buffer.from("png-bytes").toString("base64")
  };

  it("accepts a minimal attachment without cid or contentType", () => {
    expect(inlineAttachmentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unpadded or non-base64 content", () => {
    expect(
      inlineAttachmentSchema.safeParse({ ...valid, contentBase64: "abc" })
        .success
    ).toBe(false);
    expect(
      inlineAttachmentSchema.safeParse({ ...valid, contentBase64: "ab cd" })
        .success
    ).toBe(false);
  });

  it("enforces the decoded size cap, not the base64 length", () => {
    const atCap = Buffer.alloc(INLINE_ATTACHMENT_MAX_BYTES).toString("base64");
    const overCap = Buffer.alloc(INLINE_ATTACHMENT_MAX_BYTES + 1).toString(
      "base64"
    );
    expect(
      inlineAttachmentSchema.safeParse({ ...valid, contentBase64: atCap })
        .success
    ).toBe(true);
    expect(
      inlineAttachmentSchema.safeParse({ ...valid, contentBase64: overCap })
        .success
    ).toBe(false);
  });

  it("rejects a cid with whitespace or angle brackets", () => {
    expect(
      inlineAttachmentSchema.safeParse({ ...valid, cid: "qr code" }).success
    ).toBe(false);
    expect(
      inlineAttachmentSchema.safeParse({ ...valid, cid: "<qr>" }).success
    ).toBe(false);
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

  // "" is the only thing a cleared text input can send, and it has to mean
  // "remove the Reply-To" — distinct from omitting the key, which means
  // "leave whatever is stored".
  it("takes an empty Reply-To as a clear, and rejects a malformed one", () => {
    expect(
      smtpConnectionUpdateSchema.safeParse({ replyTo: "" }).success
    ).toBe(true);
    expect(
      smtpConnectionUpdateSchema.safeParse({ replyTo: "replies@example.com" })
        .success
    ).toBe(true);
    expect(
      smtpConnectionUpdateSchema.safeParse({ replyTo: "not-an-address" })
        .success
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

  it("accepts a new list name as an alternative to an existing id", () => {
    expect(
      csvImportSchema.safeParse({
        organizationId: "org_1",
        contactListName: "Newsletter signups"
      }).success
    ).toBe(true);
  });

  it("rejects an id and a name together rather than picking one silently", () => {
    const parsed = csvImportSchema.safeParse({
      organizationId: "org_1",
      contactListId: "list_1",
      contactListName: "Newsletter signups"
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].path).toEqual([
      "contactListName"
    ]);
  });

  it("rejects a blank list name", () => {
    expect(
      csvImportSchema.safeParse({
        organizationId: "org_1",
        contactListName: ""
      }).success
    ).toBe(false);
  });
});

describe("contactBulkDeleteSchema", () => {
  it("requires at least one id", () => {
    expect(
      contactBulkDeleteSchema.safeParse({
        organizationId: "org_1",
        contactIds: []
      }).success
    ).toBe(false);
  });

  it("accepts a list of ids", () => {
    expect(
      contactBulkDeleteSchema.safeParse({
        organizationId: "org_1",
        contactIds: ["c_1", "c_2"]
      }).success
    ).toBe(true);
  });

  it("caps a single request so one call can't clear a whole table", () => {
    expect(
      contactBulkDeleteSchema.safeParse({
        organizationId: "org_1",
        contactIds: Array.from({ length: 1001 }, (_, i) => `c_${i}`)
      }).success
    ).toBe(false);
  });
});

describe("recurringSendCreateSchema", () => {
  const base = {
    organizationId: "org_1",
    name: "Weekly digest",
    subject: "Digest",
    html: "<p>hi</p>",
    to: ["person@example.com"],
    cronExpression: "0 9 * * 1",
    timezone: "UTC"
  };

  it("accepts a valid recurring send", () => {
    expect(recurringSendCreateSchema.safeParse(base).success).toBe(true);
  });

  it("accepts contacts or lists as the only recipients", () => {
    expect(
      recurringSendCreateSchema.safeParse({
        ...base,
        to: undefined,
        listIds: ["list_1"]
      }).success
    ).toBe(true);
    expect(
      recurringSendCreateSchema.safeParse({
        ...base,
        to: undefined,
        contactIds: ["c_1"]
      }).success
    ).toBe(true);
  });

  it("rejects a send with no recipients at all", () => {
    const parsed = recurringSendCreateSchema.safeParse({
      ...base,
      to: undefined
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].path).toEqual([
      "to"
    ]);
  });

  it("rejects a send with no body", () => {
    const parsed = recurringSendCreateSchema.safeParse({
      ...base,
      html: undefined
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].path).toEqual([
      "html"
    ]);
  });

  it("accepts a text-only body", () => {
    expect(
      recurringSendCreateSchema.safeParse({
        ...base,
        html: undefined,
        text: "plain"
      }).success
    ).toBe(true);
  });

  it("rejects an invalid cron expression", () => {
    expect(
      recurringSendCreateSchema.safeParse({
        ...base,
        cronExpression: "not a cron"
      }).success
    ).toBe(false);
  });

  it("rejects an unknown timezone", () => {
    expect(
      recurringSendCreateSchema.safeParse({
        ...base,
        timezone: "Mars/Olympus_Mons"
      }).success
    ).toBe(false);
  });
});

describe("recurringSendUpdateSchema", () => {
  it("allows a partial update", () => {
    expect(recurringSendUpdateSchema.safeParse({}).success).toBe(true);
    expect(
      recurringSendUpdateSchema.safeParse({ name: "Renamed" }).success
    ).toBe(true);
  });

  it("still validates the cron when one is supplied", () => {
    expect(
      recurringSendUpdateSchema.safeParse({ cronExpression: "nope" }).success
    ).toBe(false);
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

describe("suppression policy helpers", () => {
  const defaults = { softBounceThreshold: 3, softBounceWindowDays: 30 };

  it("resolveSuppressionPolicy prefers the org row over defaults", () => {
    expect(
      resolveSuppressionPolicy(
        { softBounceThreshold: 5, softBounceWindowDays: 7 },
        defaults
      )
    ).toEqual({ softBounceThreshold: 5, softBounceWindowDays: 7 });
  });

  it("resolveSuppressionPolicy falls back per-field for a missing row", () => {
    expect(resolveSuppressionPolicy(null, defaults)).toEqual(defaults);
    expect(
      resolveSuppressionPolicy({ softBounceThreshold: 1 }, defaults)
    ).toEqual({ softBounceThreshold: 1, softBounceWindowDays: 30 });
  });

  it("shouldSuppressBounce suppresses hard and block bounces without counting", async () => {
    for (const bounceType of ["HARD", "BLOCK"] as const) {
      const countSoftBouncesSince = vi.fn();
      await expect(
        shouldSuppressBounce({
          bounceType,
          policy: defaults,
          countSoftBouncesSince
        })
      ).resolves.toBe(true);
      expect(countSoftBouncesSince).not.toHaveBeenCalled();
    }
  });

  it("shouldSuppressBounce compares the soft count against the threshold over the window", async () => {
    const countSoftBouncesSince = vi.fn().mockResolvedValue(2);
    const before = Date.now();

    await expect(
      shouldSuppressBounce({
        bounceType: "SOFT",
        policy: defaults,
        countSoftBouncesSince
      })
    ).resolves.toBe(false);

    const windowStart = countSoftBouncesSince.mock.calls[0][0] as Date;
    const expectedStart = before - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(windowStart.getTime() - expectedStart)).toBeLessThan(5_000);

    countSoftBouncesSince.mockResolvedValue(3);
    await expect(
      shouldSuppressBounce({
        bounceType: "SOFT",
        policy: defaults,
        countSoftBouncesSince
      })
    ).resolves.toBe(true);
  });
});

describe("deriveReputationAlerts", () => {
  function overview(
    attempted: number,
    rates: Partial<DeliverabilityOverview["rates"]> = {},
  ): DeliverabilityOverview {
    return {
      window: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z" },
      deliverySignal: "none",
      totals: {
        attempted,
        sent: attempted,
        failed: 0,
        suppressedAtSend: 0,
        cancelled: 0,
        inFlight: 0,
        confirmedDelivered: 0,
        bounced: 0,
        hardBounced: 0,
        softBounced: 0,
        blockBounced: 0,
        complained: 0,
        opened: 0,
        clicked: 0,
        suppressedInWindow: 0,
        suppressedTotal: 0,
      },
      rates: {
        accepted: 1,
        confirmedDelivery: null,
        bounce: 0,
        complaint: 0,
        open: 0,
        click: 0,
        ...rates,
      },
    };
  }

  it("flags a bounce rate above 5%", () => {
    const alerts = deriveReputationAlerts(overview(1000, { bounce: 0.06 }));
    expect(alerts.map((a) => a.metric)).toEqual(["bounceRate"]);
    expect(alerts[0].level).toBe("critical");
  });

  it("flags a complaint rate above 0.1%", () => {
    const alerts = deriveReputationAlerts(overview(1000, { complaint: 0.002 }));
    expect(alerts.map((a) => a.metric)).toEqual(["complaintRate"]);
  });

  it("stays quiet exactly at the threshold", () => {
    expect(deriveReputationAlerts(overview(1000, { bounce: 0.05 }))).toEqual([]);
    expect(
      deriveReputationAlerts(overview(1000, { complaint: 0.001 })),
    ).toEqual([]);
  });

  it("does not cry wolf below the minimum volume", () => {
    // 40% of 5 sends is past every line and means nothing.
    expect(
      deriveReputationAlerts(overview(5, { bounce: 0.4, complaint: 0.2 })),
    ).toEqual([]);
    // ...but the same rate on real volume is a genuine emergency.
    expect(
      deriveReputationAlerts(overview(50, { bounce: 0.4, complaint: 0.2 })),
    ).toHaveLength(2);
  });

  it("treats a null rate as unmeasured, not as zero", () => {
    // A rate with no denominator must never be compared against a threshold.
    expect(
      deriveReputationAlerts(overview(1000, { bounce: null, complaint: null })),
    ).toEqual([]);
  });
});

describe("organizationBrandingSchema", () => {
  const base = {
    brandName: "Acme",
    logoUrl: "https://cdn.example.com/logo.png",
    accentColor: "#2E7D63",
    footerNote: "Acme Inc, 400 Market St",
    brandingEnabled: true
  };

  it("accepts a fully populated branding payload", () => {
    expect(organizationBrandingSchema.parse(base)).toEqual(base);
  });

  it("normalises empty strings to null, so clearing a field means 'add nothing'", () => {
    expect(
      organizationBrandingSchema.parse({
        brandName: "",
        logoUrl: "   ",
        accentColor: "",
        footerNote: "",
        brandingEnabled: false
      })
    ).toEqual({
      brandName: null,
      logoUrl: null,
      accentColor: null,
      footerNote: null,
      brandingEnabled: false
    });
  });

  it("rejects a relative logo URL — a mail client has nothing to resolve it against", () => {
    expect(() =>
      organizationBrandingSchema.parse({ ...base, logoUrl: "/images/logo.png" })
    ).toThrow();
  });

  it("rejects a colour that is not six-digit hex", () => {
    expect(() =>
      organizationBrandingSchema.parse({ ...base, accentColor: "green" })
    ).toThrow();
    expect(() =>
      organizationBrandingSchema.parse({ ...base, accentColor: "#2E7" })
    ).toThrow();
  });

  it("trims a brand name and caps its length", () => {
    expect(
      organizationBrandingSchema.parse({ ...base, brandName: "  Acme  " })
        .brandName
    ).toBe("Acme");
    expect(() =>
      organizationBrandingSchema.parse({ ...base, brandName: "a".repeat(101) })
    ).toThrow();
  });
});

describe("resolveInboxNotify", () => {
  const mailbox = { inboxAccountId: "inbox_1", domain: "acme.test" };

  it("notifies when nothing has been said about the mailbox", () => {
    // The default is on, and both the API and the worker depend on it: a
    // mailbox somebody was granted this morning has no rules yet and must not
    // be silently unreachable.
    expect(resolveInboxNotify([], mailbox)).toEqual({
      enabled: true,
      explicit: false,
    });
  });

  it("honours a rule naming the mailbox", () => {
    expect(
      resolveInboxNotify(
        [
          {
            scope: "MAILBOX",
            domain: null,
            inboxAccountId: "inbox_1",
            enabled: false,
          },
        ],
        mailbox
      )
    ).toEqual({ enabled: false, explicit: true });
  });

  it("falls back to the domain rule, marking it inherited", () => {
    expect(
      resolveInboxNotify(
        [
          {
            scope: "DOMAIN",
            domain: "acme.test",
            inboxAccountId: null,
            enabled: false,
          },
        ],
        mailbox
      )
    ).toEqual({ enabled: false, explicit: false });
  });

  it("lets the mailbox rule beat the domain rule above it", () => {
    // "Nothing from acme.test except support@". Most specific wins, which is
    // what makes a switched-off domain still carveable.
    expect(
      resolveInboxNotify(
        [
          {
            scope: "DOMAIN",
            domain: "acme.test",
            inboxAccountId: null,
            enabled: false,
          },
          {
            scope: "MAILBOX",
            domain: null,
            inboxAccountId: "inbox_1",
            enabled: true,
          },
        ],
        mailbox
      )
    ).toEqual({ enabled: true, explicit: true });
  });

  it("ignores rules about other mailboxes and other domains", () => {
    expect(
      resolveInboxNotify(
        [
          {
            scope: "MAILBOX",
            domain: null,
            inboxAccountId: "inbox_9",
            enabled: false,
          },
          {
            scope: "DOMAIN",
            domain: "elsewhere.test",
            inboxAccountId: null,
            enabled: false,
          },
        ],
        mailbox
      ).enabled
    ).toBe(true);
  });
});

describe("mailboxDomain", () => {
  it("lowercases the domain half, which is the key rules are stored under", () => {
    expect(mailboxDomain("Support@ACME.test")).toBe("acme.test");
  });

  it("returns an empty string for an address with no domain", () => {
    // A malformed mailbox should group oddly on a settings page, not take the
    // page down.
    expect(mailboxDomain("not-an-address")).toBe("");
  });
});
