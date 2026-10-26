import { spawnSync } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.API_PORT ??= "4000";
process.env.DATABASE_URL ??=
  "postgresql://qqueue:qqueue@localhost:55432/qqueue";
process.env.REDIS_HOST ??= "localhost";
process.env.REDIS_PORT ??= "56379";
process.env.JWT_ACCESS_SECRET ??= "smoke-access-secret";
process.env.JWT_REFRESH_SECRET ??= "smoke-refresh-secret";
process.env.ENCRYPTION_KEY ??= "smoke-encryption-key";
process.env.APP_URL ??= "http://localhost:4000";
process.env.TRACKING_SECRET ??= "smoke-tracking-secret";
process.env.WEBHOOK_SECRET ??= "smoke-webhook-secret";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    // pnpm is a .cmd shim on Windows, which Node refuses to spawn shell-less.
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function startFakeSmtp(): Promise<{
  server: Server;
  port: number;
  sockets: Set<Socket>;
  messages: string[];
  envelopes: string[][];
  controls: { rejectRecipient: string; dropDataResponse: boolean };
}> {
  const controls = { rejectRecipient: "", dropDataResponse: false };
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  const envelopes: string[][] = [];
  const server = createServer((socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let inData = false;
    let authLoginStep = 0;
    let pending = "";
    let messageLines: string[] = [];
    let recipients: string[] = [];

    socket.write("220 qqueue-smoke ESMTP\r\n");
    socket.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const rawLine = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        const line = rawLine.trim();

        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(messageLines.join("\r\n"));
            envelopes.push([...recipients]);
            messageLines = [];
            if (controls.dropDataResponse) socket.destroy();
            else socket.write("250 queued\r\n");
          } else {
            messageLines.push(rawLine);
          }
          continue;
        }

        if (!line) continue;

        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          socket.write(
            "250-qqueue-smoke\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
          );
        } else if (upper.startsWith("AUTH PLAIN")) {
          socket.write("235 authenticated\r\n");
        } else if (upper.startsWith("AUTH LOGIN")) {
          authLoginStep = 1;
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (authLoginStep === 1) {
          authLoginStep = 2;
          socket.write("334 UGFzc3dvcmQ6\r\n");
        } else if (authLoginStep === 2) {
          authLoginStep = 0;
          socket.write("235 authenticated\r\n");
        } else if (upper.startsWith("MAIL FROM") || upper === "RSET") {
          recipients = [];
          socket.write("250 OK\r\n");
        } else if (upper.startsWith("RCPT TO")) {
          const recipient = /<([^>]+)>/.exec(line)?.[1] ?? "";
          if (recipient === controls.rejectRecipient)
            socket.write("550 5.1.1 No such mailbox\r\n");
          else {
            recipients.push(recipient);
            socket.write("250 OK\r\n");
          }
        } else if (upper === "NOOP") {
          socket.write("250 OK\r\n");
        } else if (upper === "DATA") {
          inData = true;
          socket.write("354 end with <CR><LF>.<CR><LF>\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Fake SMTP server did not bind to a TCP port");
      }
      resolve({
        server,
        port: address.port,
        sockets,
        messages,
        envelopes,
        controls,
      });
    });
  });
}

async function eventually<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 10_000
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for smoke-test condition");
}

async function main() {
  run("pnpm", [
    "exec",
    "prisma",
    "generate",
    "--schema",
    "apps/api/prisma/schema",
  ]);

  run("pnpm", [
    "exec",
    "prisma",
    "migrate",
    "deploy",
    "--schema",
    "apps/api/prisma/schema",
  ]);

  const [
    { createApp },
    { prisma },
    { startEmailSendingWorker },
    { startCampaignProcessingWorker },
    { emailSendingQueue },
    { campaignProcessingQueue },
    { webhookDeliveryQueue },
    { inboxSyncQueue },
  ] = await Promise.all([
    import("../apps/api/src/app.js"),
    import("../apps/api/src/lib/prisma.js"),
    import("../apps/worker/src/workers/email-sending.worker.js"),
    import("../apps/worker/src/workers/campaign-processing.worker.js"),
    import("../apps/api/src/queues/email-sending.queue.js"),
    import("../apps/api/src/queues/campaign-processing.queue.js"),
    import("../apps/api/src/queues/webhook-delivery.queue.js"),
    import("../apps/api/src/queues/inbox-sync.queue.js"),
  ]);

  const {
    server: smtpServer,
    port: smtpPort,
    sockets: smtpSockets,
    messages: smtpMessages,
    envelopes: smtpEnvelopes,
    controls: smtpControls,
  } = await startFakeSmtp();
  const worker = startEmailSendingWorker();
  const campaignWorker = startCampaignProcessingWorker();
  const app = createApp();

  try {
    const email = `smoke-${Date.now()}@example.com`;
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email,
        password: "password123",
        organizationName: "Smoke Test",
      })
      .expect(201);

    const accessToken = register.body.data.tokens.accessToken as string;
    const organizationId = register.body.data.organization.id as string;
    const auth = `Bearer ${accessToken}`;

    // The first registration bootstraps the instance (instance admin) and
    // locks public registration until the setup wizard records a choice, so a
    // second walk-up signup must be rejected.
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: `second-${Date.now()}@example.com`,
        password: "password123",
      })
      .expect(403);

    const midSetup = await request(app).get("/api/v1/setup/status").expect(200);
    if (
      midSetup.body.data.needsSetup !== false ||
      midSetup.body.data.setupCompleted !== false ||
      midSetup.body.data.allowPublicRegistration !== false
    ) {
      throw new Error(
        `Unexpected mid-setup status: ${JSON.stringify(midSetup.body.data)}`
      );
    }

    // Finish first-run setup, keeping the instance invite-only.
    await request(app)
      .post("/api/v1/setup/complete")
      .set("Authorization", auth)
      .send({ allowPublicRegistration: false })
      .expect(201);

    const completed = await request(app)
      .get("/api/v1/setup/status")
      .expect(200);
    if (completed.body.data.setupCompleted !== true) {
      throw new Error(
        `Setup completion not reflected: ${JSON.stringify(completed.body.data)}`
      );
    }

    await request(app)
      .post("/api/v1/smtp-connections")
      .set("Authorization", auth)
      .send({
        organizationId,
        name: "Smoke SMTP",
        host: "127.0.0.1",
        port: smtpPort,
        secure: false,
        username: "smtp-user",
        password: "smtp-password",
        fromEmail: "sender@example.com",
        fromName: "QQueue Smoke",
        isDefault: true,
      })
      .expect(201);

    const scheduledAt = new Date(Date.now() + 500).toISOString();
    const send = await request(app)
      .post("/api/v1/transactional-email/send")
      .set("Authorization", auth)
      .send({
        organizationId,
        to: "recipient@example.com",
        subject: "Smoke test",
        text: "Smoke test",
        isBulk: true,
        headers: {
          "List-Unsubscribe": "<https://example.com/unsubscribe/signed-token>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        scheduledAt,
      })
      .expect(202);

    const emailJobId = send.body.data.id as string;
    const sentJob = await eventually(() =>
      prisma.emailJob.findFirst({
        where: { id: emailJobId, status: "SENT" },
        select: { id: true, status: true, messageId: true },
      })
    );

    const rawMessage = smtpMessages[0] ?? "";
    const rawBody = rawMessage.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    if (
      !rawMessage.includes(
        "List-Unsubscribe: <https://example.com/unsubscribe/signed-token>"
      ) ||
      !rawMessage.includes(
        "List-Unsubscribe-Post: List-Unsubscribe=One-Click"
      ) ||
      !rawBody.includes("https://example.com/unsubscribe/signed-token") ||
      !rawBody.includes("Smoke test")
    ) {
      throw new Error(
        "Smoke SMTP message is missing the one-click headers or body footer"
      );
    }

    // A nullable layout preserves existing organizations; customization retains identity.
    const legacyBranding = await request(app).get(`/api/v1/organizations/${organizationId}/branding`)
      .set("Authorization", auth).expect(200);
    if (legacyBranding.body.data.layoutHtml !== null) throw new Error("New layout changed the legacy branding default");
    const customBranding = {
      brandName: "CustomBranding",
      logoUrl: "https://example.com/logo.png",
      accentColor: "#123456",
      footerNote: "PreservedAddress",
      brandingEnabled: true,
      layoutHtml: '<html><body><header>{{brand_name}}</header><img src="{{logo_url}}" alt="Logo" /><main>{{content}}</main><footer>{{footer_note}}</footer></body></html>'
    };
    await request(app).put(`/api/v1/organizations/${organizationId}/branding`)
      .set("Authorization", auth).send(customBranding).expect(200);
    const savedBranding = await request(app).get(`/api/v1/organizations/${organizationId}/branding`)
      .set("Authorization", auth).expect(200);
    if (savedBranding.body.data.layoutHtml !== customBranding.layoutHtml || savedBranding.body.data.logoUrl !== customBranding.logoUrl) throw new Error("Branding HTML or existing logo did not round-trip");

    // Campaign choices travel through API -> fan-out -> queue -> actual SMTP.
    const campaignContact = await prisma.contact.create({
      data: { organizationId, email: "campaign-recipient@example.com" }
    });
    const campaignList = await prisma.contactList.create({
      data: {
        organizationId,
        name: "Campaign smoke",
        members: { create: { contactId: campaignContact.id } }
      }
    });
    const campaignTemplate = await prisma.template.create({
      data: {
        organizationId,
        name: "Campaign smoke",
        subject: "Campaign smoke",
        html: "<p>Campaign body</p>",
        text: "Campaign body"
      }
    });
    for (const enabled of [true, false]) {
      const created = await request(app)
        .post("/api/v1/campaigns")
        .set("Authorization", auth)
        .send({
          organizationId,
          name: `Unsubscribe ${enabled}`,
          templateId: campaignTemplate.id,
          contactListId: campaignList.id,
          unsubscribeEnabled: enabled
        })
        .expect(201);
      if (created.body.data.unsubscribeEnabled !== enabled)
        throw new Error("Campaign API lost unsubscribe setting");
      const messageStart = smtpMessages.length;
      await request(app)
        .post(`/api/v1/campaigns/${created.body.data.id}/send`)
        .set("Authorization", auth)
        .expect(200);
      const delivered = await eventually(() =>
        prisma.emailJob.findFirst({
          where: { campaignId: created.body.data.id, status: "SENT" }
        })
      );
      if (delivered.unsubscribeEnabled !== enabled || !delivered.isBulk)
        throw new Error(
          "Campaign job lost unsubscribe setting or bulk classification"
        );
      const raw = smtpMessages[messageStart] ?? "";
      const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      if (
        !body.includes("Campaign body") ||
        body.includes("CustomBranding") ||
        body.includes("qq-branding-footer-note") ||
        body.includes("Unsubscribe") !== enabled
      ) {
        throw new Error("Campaign SMTP layout or unsubscribe footer failed");
      }
      if (
        /^List-Unsubscribe:/im.test(raw) !== enabled ||
        /^List-Unsubscribe-Post:/im.test(raw) !== enabled
      ) {
        throw new Error(`Campaign SMTP unsubscribe toggle failed for ${enabled}`);
      }
    }

    // Group messages retain their full headers and identity on the SMTP wire.
    // A sibling To job must not receive the carrier's copy recipients again.
    const groupPayload = {
      organizationId,
      to: ["group-a@example.com", "group-b@example.com"],
      cc: ["group-copy@example.com"],
      bcc: ["group-private@example.com"],
      subject: "Group smoke",
      text: "Group conversation",
      idempotencyKey: "group-smoke",
    };
    const groupStart = smtpMessages.length;
    const group = await request(app)
      .post("/api/v1/manual-email/send")
      .set("Authorization", auth)
      .send(groupPayload)
      .expect(202);
    const groupReplay = await request(app)
      .post("/api/v1/manual-email/send")
      .set("Authorization", auth)
      .send(groupPayload)
      .expect(202);
    if (group.body.data.id !== groupReplay.body.data.id)
      throw new Error("Group retry created another carrier");
    const carrier = await prisma.emailJob.findUniqueOrThrow({
      where: { id: group.body.data.id },
    });
    await eventually(async () => {
      const jobs = await prisma.emailJob.findMany({
        where: { organizationId, sendGroupId: carrier.sendGroupId },
      });
      return jobs.length === 4 && jobs.every((job) => job.status === "SENT")
        ? jobs
        : null;
    });
    const groupMessages = smtpMessages.slice(groupStart);
    const header = (raw: string, name: string) =>
      raw
        .split("\r\n\r\n")[0]
        .replace(/\r\n[ \t]+/g, " ")
        .split("\r\n")
        .find((line) =>
          line.toLowerCase().startsWith(`${name.toLowerCase()}:`)
        );
    if (
      groupMessages.length !== 4 ||
      groupMessages.some(
        (raw) =>
          header(raw, "To") !==
            "To: group-a@example.com, group-b@example.com" ||
          header(raw, "Cc") !== "Cc: group-copy@example.com" ||
          header(raw, "Bcc") ||
          header(raw, "Message-ID") !== `Message-ID: ${carrier.messageId}`
      )
    )
      throw new Error(
        "Group SMTP headers, Bcc privacy, or message identity are incorrect"
      );

    const deliveredAddresses = smtpEnvelopes.slice(groupStart).flat().sort();
    if (
      JSON.stringify(deliveredAddresses) !==
      JSON.stringify([
        "group-a@example.com",
        "group-b@example.com",
        "group-copy@example.com",
        "group-private@example.com",
      ])
    )
      throw new Error("Group SMTP envelope duplicated or omitted a recipient");

    // Exercise actual competing requests, tombstones and rolled-back attachments.
    const draftPayload = {
      organizationId,
      clientId: "durable-draft",
      subject: "Safe draft",
      text: "Draft body",
      to: ["draft@example.com"],
    };
    const creates = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post("/api/v1/email-drafts")
          .set("Authorization", auth)
          .send(draftPayload)
          .expect(201)
      )
    );
    if (creates[0].body.data.id !== creates[1].body.data.id)
      throw new Error("Lost create responses duplicate drafts");
    const draft = creates[0].body.data;
    const competing = await Promise.all(
      ["edit-a", "edit-b"].map((mutationId) =>
        request(app)
          .put(`/api/v1/email-drafts/${draft.id}`)
          .set("Authorization", auth)
          .send({
            subject: "Safe updated draft",
            expectedRevision: 1,
            mutationId,
          })
      )
    );
    if (
      competing
        .map((res) => res.status)
        .sort()
        .join(",") !== "200,409"
    )
      throw new Error("Concurrent draft edits overwrote each other");
    const updatedDraft = competing.find((res) => res.status === 200)!.body.data;
    const scheduledSend = {
      organizationId,
      draftId: draft.id,
      expectedRevision: updatedDraft.revision,
      idempotencyKey: draft.id,
      subject: "Safe updated draft",
      text: "Draft body",
      to: ["draft@example.com"],
      cc: ["draft-copy@example.com"],
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    await request(app)
      .post("/api/v1/manual-email/send")
      .set("Authorization", auth)
      .send({ ...scheduledSend, attachmentIds: ["unavailable"] })
      .expect(409);
    if (
      await prisma.emailJob.count({
        where: { organizationId, subject: scheduledSend.subject },
      })
    )
      throw new Error("Failed attachment preparation left sendable jobs");
    const acceptedDraft = await request(app)
      .post("/api/v1/manual-email/send")
      .set("Authorization", auth)
      .send(scheduledSend)
      .expect(202);
    const acceptedReplay = await request(app)
      .post("/api/v1/manual-email/send")
      .set("Authorization", auth)
      .send(scheduledSend)
      .expect(202);
    if (acceptedDraft.body.data.id !== acceptedReplay.body.data.id)
      throw new Error("Lost send responses duplicate accepted mail");
    await request(app)
      .post("/api/v1/manual-email/send")
      .set("Authorization", auth)
      .send({ ...scheduledSend, to: ["another@example.com"] })
      .expect(409);
    await request(app)
      .put(`/api/v1/email-drafts/${draft.id}`)
      .set("Authorization", auth)
      .send({
        subject: "Late stale edit",
        expectedRevision: updatedDraft.revision,
        mutationId: "late",
      })
      .expect(409);
    const draftsAfterSend = await request(app)
      .get(`/api/v1/email-drafts?organizationId=${organizationId}`)
      .set("Authorization", auth)
      .expect(200);
    if (
      draftsAfterSend.body.data.some(
        (row: { id: string }) => row.id === draft.id
      )
    )
      throw new Error("Completed draft remained editable");
    const draftJobs = await prisma.emailJob.findMany({
      where: { organizationId, subject: scheduledSend.subject },
    });
    if (draftJobs.length !== 2)
      throw new Error("Draft retries changed accepted recipient set");
    await request(app)
      .post(
        `/api/v1/outbox/${acceptedDraft.body.data.id}/cancel?organizationId=${organizationId}`
      )
      .set("Authorization", auth)
      .expect(200);
    if (
      await prisma.emailJob.count({
        where: {
          organizationId,
          subject: scheduledSend.subject,
          status: { not: "CANCELLED" },
        },
      })
    )
      throw new Error("Cancellation left sibling deliveries queued");

    // Partial acceptance must not poison the accepted recipient's suppression.
    smtpControls.rejectRecipient = "reject@example.com";
    const partial = await request(app)
      .post("/api/v1/transactional-email/send")
      .set("Authorization", auth)
      .send({
        organizationId,
        to: "accepted@example.com",
        cc: [smtpControls.rejectRecipient],
        subject: "Partial SMTP",
        text: "Partial outcome",
      })
      .expect(202);
    await eventually(async () => {
      const row = await prisma.emailJob.findUnique({
        where: { id: partial.body.data.id },
      });
      return row?.status === "SENT" ? row : null;
    });
    await eventually(() =>
      prisma.suppression.findUnique({
        where: {
          organizationId_email: {
            organizationId,
            email: smtpControls.rejectRecipient,
          },
        },
      })
    );
    if (
      await prisma.suppression.findUnique({
        where: {
          organizationId_email: {
            organizationId,
            email: "accepted@example.com",
          },
        },
      })
    )
      throw new Error("Partial rejection suppressed an accepted recipient");
    smtpControls.rejectRecipient = "";

    // The server receives DATA but drops its response: a wire-level ambiguity.
    smtpControls.dropDataResponse = true;
    const uncertainStart = smtpMessages.length;
    const uncertain = await request(app)
      .post("/api/v1/transactional-email/send")
      .set("Authorization", auth)
      .send({
        organizationId,
        to: "uncertain@example.com",
        subject: "Lost DATA response",
        text: "Uncertain outcome",
      })
      .expect(202);
    await eventually(async () => {
      const row = await prisma.emailJob.findUnique({
        where: { id: uncertain.body.data.id },
      });
      return row?.status === "UNCERTAIN" ? row : null;
    });
    await emailSendingQueue.add(
      "send-email",
      { emailJobId: uncertain.body.data.id },
      { jobId: `uncertain-replay-${uncertain.body.data.id}` }
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (smtpMessages.length !== uncertainStart + 1)
      throw new Error("Uncertain SMTP outcome was automatically resent");
    smtpControls.dropDataResponse = false;

    // Exercise the mailbox flows against real Postgres, not only query mocks.
    const connection = await prisma.sMTPConnection.findFirstOrThrow({
      where: { organizationId },
    });
    const system = await prisma.emailJob.create({
      data: {
        organizationId,
        smtpConnectionId: connection.id,
        origin: "SYSTEM",
        subject: "Private reset",
        html: "<p>private-reset-token</p>",
        toEmail: email,
        status: "SENT",
      },
    });
    await request(app)
      .get(`/api/v1/sent/${system.id}?organizationId=${organizationId}`)
      .set("Authorization", auth)
      .expect(404);
    const archive = await request(app)
      .get(`/api/v1/sent?organizationId=${organizationId}&origin=SYSTEM`)
      .set("Authorization", auth)
      .expect(200);
    if (archive.body.data.rows.length !== 0)
      throw new Error("System email appeared in the shared archive");
    const mailbox = await prisma.inboxAccount.create({
      data: {
        organizationId,
        name: "Smoke inbox",
        email: "sender@example.com",
        host: "localhost",
        port: 993,
        secure: true,
        usernameEncrypted: "unused",
        passwordEncrypted: "unused",
        mailbox: "INBOX",
      },
    });
    const inbound = [];
    for (let index = 0; index < 3; index++) {
      inbound.push(
        await prisma.inboundMessage.create({
          data: {
            organizationId,
            inboxAccountId: mailbox.id,
            messageId: `<smoke-inbound-${index}>`,
            references: ["<smoke-root>"],
            fromEmail: "customer@example.com",
            replyTo: ["answers@example.com"],
            to: ["sender@example.com"],
            subject: "Question",
            text: `Message ${index}`,
            receivedAt: new Date(Date.now() + index),
          },
        })
      );
    }
    const firstPage = await request(app)
      .get(`/api/v1/inbox/messages?organizationId=${organizationId}&limit=2`)
      .set("Authorization", auth)
      .expect(200);
    const secondPage = await request(app)
      .get(
        `/api/v1/inbox/messages?organizationId=${organizationId}&limit=2&cursor=${firstPage.body.data.nextCursor}`
      )
      .set("Authorization", auth)
      .expect(200);
    if (secondPage.body.data.data.length !== 1)
      throw new Error("Inbox pagination skipped a message");
    // Real PostgreSQL union search: literal queries, complete cursor boundaries,
    // and private SYSTEM exclusion are not established by query mocks.
    const searchOne=await request(app).get(`/api/v1/mail-search?organizationId=${organizationId}&q=Question&limit=1`).set("Authorization",auth).expect(200);
    const searchTwo=await request(app).get(`/api/v1/mail-search?organizationId=${organizationId}&q=Question&limit=1&cursor=${encodeURIComponent(searchOne.body.data.nextCursor)}`).set("Authorization",auth).expect(200);
    if(searchOne.body.data.rows[0].id===searchTwo.body.data.rows[0].id) throw new Error("Unified search repeated a page boundary");
    const privateSearch=await request(app).get(`/api/v1/mail-search?organizationId=${organizationId}&q=private-reset-token`).set("Authorization",auth).expect(200);
    if(privateSearch.body.data.rows.length) throw new Error("Unified search exposed SYSTEM content");
    await request(app).get(`/api/v1/mail-search?organizationId=${organizationId}&q=changed&cursor=${encodeURIComponent(searchOne.body.data.nextCursor)}`).set("Authorization",auth).expect(400);
    await request(app)
      .patch("/api/v1/inbox/messages/read")
      .set("Authorization", auth)
      .send({
        organizationId,
        messageIds: inbound.map((message) => message.id),
        read: true,
      })
      .expect(200);
    const conversation = await request(app)
      .get(
        `/api/v1/inbox/messages/${inbound[0].id}/conversation?organizationId=${organizationId}`
      )
      .set("Authorization", auth)
      .expect(200);
    if (conversation.body.data.messages.length !== 3)
      throw new Error("Conversation omitted received messages");
    const reply = await request(app)
      .post(`/api/v1/inbox/messages/${inbound[0].id}/reply`)
      .set("Authorization", auth)
      .send({
        organizationId,
        subject: "Question",
        html: "<p>A reply through the shared pipeline</p>",
        idempotencyKey: "smoke-reply",
      })
      .expect(202);
    const replay = await request(app)
      .post(`/api/v1/inbox/messages/${inbound[0].id}/reply`)
      .set("Authorization", auth)
      .send({
        organizationId,
        subject: "Question",
        html: "<p>A reply through the shared pipeline</p>",
        idempotencyKey: "smoke-reply",
      })
      .expect(202);
    if (reply.body.data.id !== replay.body.data.id)
      throw new Error("Reply retry created a duplicate send");
    await eventually(() =>
      prisma.emailJob.findFirst({
        where: {
          id: reply.body.data.id,
          status: "SENT",
          toEmail: "answers@example.com",
          smtpConnectionId: connection.id,
        },
      })
    );
    // An owner may keep this mailbox private from an otherwise privileged admin.
    const admin = await prisma.user.create({ data: { email: `admin-${Date.now()}@example.com`, passwordHash: "unused" } });
    await prisma.organizationMember.create({ data: { organizationId, userId: admin.id, role: "ADMIN" } });
    const { createAuthTokens } = await import("../apps/api/src/lib/tokens.js");
    const adminAuth = `Bearer ${createAuthTokens(admin).accessToken}`;
    const accountsUrl = `/api/v1/inbox/accounts?organizationId=${organizationId}`;
    const grantsUrl = `/api/v1/smtp-connections/${connection.id}/grants`;
    const beforeRevoke = await request(app).get(accountsUrl).set("Authorization", adminAuth).expect(200);
    if (!beforeRevoke.body.data.some((row: { id: string }) => row.id === mailbox.id)) throw new Error("Upgrade/default admin access was lost");
    const adminKey = await request(app).post("/api/v1/api-keys").set("Authorization", adminAuth).send({ organizationId, name: "Admin integration" }).expect(201);
    await prisma.emailJob.update({ where: { id: sentJob.id }, data: { createdByUserId: admin.id } });
    await request(app).delete(`${grantsUrl}/${admin.id}`).set("Authorization", auth).expect(204);
    const afterRevoke = await request(app).get(accountsUrl).set("Authorization", adminAuth).expect(200);
    if (afterRevoke.body.data.some((row: { id: string }) => row.id === mailbox.id)) throw new Error("Revoked admin still sees mailbox");
    const identities = await request(app).get(`/api/v1/smtp-connections?organizationId=${organizationId}`).set("Authorization", adminAuth).expect(200);
    if (identities.body.data.some((row: { id: string }) => row.id === connection.id)) throw new Error("Revoked admin still sees sending account");
    const adminSearch = await request(app).get(`/api/v1/mail-search?organizationId=${organizationId}&q=Question`).set("Authorization", adminAuth).expect(200);
    if (adminSearch.body.data.rows.length) throw new Error("Search leaked revoked mailbox");
    const ownSentSearch = await request(app).get(`/api/v1/mail-search?organizationId=${organizationId}&q=${encodeURIComponent(sentJob.subject)}`).set("Authorization", adminAuth).expect(200);
    if (ownSentSearch.body.data.rows.length) throw new Error("Search leaked revoked admin-authored mail");
    await request(app).get(`/api/v1/inbox/messages/${inbound[0].id}/conversation?organizationId=${organizationId}`).set("Authorization", adminAuth).expect(404);
    await request(app).get(`/api/v1/sent/${sentJob.id}?organizationId=${organizationId}`).set("Authorization", adminAuth).expect(404);
    await request(app).post("/api/v1/transactional-email/send").set("Authorization", adminAuth).send({ organizationId, to: "target@example.com", subject: "Denied", text: "Denied" }).expect(403);
    await request(app).post(grantsUrl).set("Authorization", adminAuth).send({ userId: admin.id }).expect(404);
    await request(app).put(`/api/v1/smtp-connections/${connection.id}`).set("Authorization", adminAuth).send({ name: "Stolen" }).expect(404);
    await request(app).patch(`/api/v1/inbox/accounts/${mailbox.id}?organizationId=${organizationId}`).set("Authorization", adminAuth).send({ name: "Stolen" }).expect(403);
    await request(app).post("/api/v1/api-keys").set("Authorization", adminAuth).send({ organizationId, name: "Bypass" }).expect(403);
    if (!(await prisma.apiKey.findUniqueOrThrow({ where: { id: adminKey.body.data.apiKey.id } })).revokedAt) throw new Error("Admin key survived revocation");
    await request(app).get(`/api/v1/queue-operations?organizationId=${organizationId}`).set("Authorization", adminAuth).expect(403);
    await request(app).post("/api/v1/webhook-endpoints").set("Authorization", adminAuth).send({ organizationId, name: "Bypass", url: "https://example.com/webhook", events: ["email.sent"] }).expect(403);
    await request(app).patch(`/api/v1/organizations/${organizationId}/members/${admin.id}`).set("Authorization", adminAuth).send({ role: "MEMBER" }).expect(403);
    const stillOwner = await request(app).get(accountsUrl).set("Authorization", auth).expect(200);
    if (!stillOwner.body.data.some((row: { id: string }) => row.id === mailbox.id)) throw new Error("Revocation removed owner access");
    await request(app).post(grantsUrl).set("Authorization", auth).send({ userId: admin.id }).expect(201);
    const restored = await request(app).get(accountsUrl).set("Authorization", adminAuth).expect(200);
    if (!restored.body.data.some((row: { id: string }) => row.id === mailbox.id)) throw new Error("Owner could not restore admin mailbox access");

    // Mailboxes selected at invitation time are usable at the first sign-in.
    const inviteEmail = `assigned-${Date.now()}@example.com`;
    const assignedInvite = await request(app).post("/api/v1/invitations").set("Authorization", auth).send({ organizationId, email: inviteEmail, role: "MEMBER", smtpConnectionIds: [connection.id] }).expect(201);
    if (assignedInvite.body.data.invite.smtpConnectionIds[0] !== connection.id) throw new Error("Invitation did not retain mailbox selection");
    const inviteToken = new URL(assignedInvite.body.data.acceptUrl).searchParams.get("token");
    const joined = await request(app).post("/api/v1/invitations/accept").send({ token: inviteToken, password: "password123", name: "Assigned teammate" }).expect(200);
    const joinedAuth = `Bearer ${joined.body.data.tokens.accessToken}`;
    const joinedInboxes = await request(app).get(accountsUrl).set("Authorization", joinedAuth).expect(200);
    if (!joinedInboxes.body.data.some((row: { id: string }) => row.id === mailbox.id)) throw new Error("Invited member did not receive read access on first sign-in");
    const joinedSenders = await request(app).get(`/api/v1/smtp-connections/sendable?organizationId=${organizationId}`).set("Authorization", joinedAuth).expect(200);
    if (!joinedSenders.body.data.some((row: { id: string }) => row.id === connection.id)) throw new Error("Invited member did not receive send access on first sign-in");
    await request(app).get(`/api/v1/inbox/messages/${inbound[0].id}/conversation?organizationId=${organizationId}`).set("Authorization", joinedAuth).expect(200);
    await request(app).post("/api/v1/invitations/accept").send({ token: inviteToken, password: "password123" }).expect(400);

    const existingInviteUser = await prisma.user.create({ data: { email: `existing-invite-${Date.now()}@example.com`, passwordHash: "unused" } });
    const existingInvite = await request(app).post("/api/v1/invitations").set("Authorization", auth).send({ organizationId, email: existingInviteUser.email, role: "MEMBER", smtpConnectionIds: [connection.id] }).expect(201);
    const existingAccepted = await request(app).post("/api/v1/invitations/accept").send({ token: new URL(existingInvite.body.data.acceptUrl).searchParams.get("token") }).expect(200);
    if (!existingAccepted.body.data.requiresSignIn || existingAccepted.body.data.tokens) throw new Error("Existing invitee was signed in without a password");
    if (!(await prisma.inboxAccountGrant.findUnique({ where: { inboxAccountId_userId: { inboxAccountId: mailbox.id, userId: existingInviteUser.id } } }))) throw new Error("Existing invitee missed mailbox assignment");

    // Owner revocation after issuance must also stop a stale pending assignment.
    const staleInviteEmail = `stale-invite-${Date.now()}@example.com`;
    const staleInvite = await request(app).post("/api/v1/invitations").set("Authorization", adminAuth).send({ organizationId, email: staleInviteEmail, role: "MEMBER", smtpConnectionIds: [connection.id] }).expect(201);
    await request(app).delete(`${grantsUrl}/${admin.id}`).set("Authorization", auth).expect(204);
    await request(app).post("/api/v1/invitations/accept").send({ token: new URL(staleInvite.body.data.acceptUrl).searchParams.get("token"), password: "password123" }).expect(403);
    const unconsumed = await prisma.organizationInvite.findUniqueOrThrow({ where: { id: staleInvite.body.data.invite.id } });
    if (unconsumed.status !== "PENDING" || await prisma.user.findUnique({ where: { email: staleInviteEmail } })) throw new Error("Failed assignment partially consumed an invite or created a user");
    await request(app).post(grantsUrl).set("Authorization", auth).send({ userId: admin.id }).expect(201);

    await request(app)
      .delete(
        `/api/v1/inbox/accounts/${mailbox.id}?organizationId=${organizationId}`
      )
      .set("Authorization", auth)
      .expect(204);
    if (
      (await prisma.inboundMessage.count({
        where: { inboxAccountId: mailbox.id },
      })) !== 3
    )
      throw new Error("Disconnect destroyed mail history");
    run("pnpm", [
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--from-url",
      process.env.DATABASE_URL!,
      "--to-schema-datamodel",
      "apps/api/prisma/schema",
      "--exit-code",
    ]);
    console.log(
      `Smoke test passed: ${sentJob.id} ${sentJob.status}; group headers/envelopes, mailbox privacy, pagination, replies, disconnect, and migration drift verified`
    );
    process.exit(0);
  } finally {
    await worker.close(true);
    await campaignWorker.close(true);
    await Promise.allSettled([
      emailSendingQueue.disconnect(),
      campaignProcessingQueue.disconnect(),
      webhookDeliveryQueue.disconnect(),
      inboxSyncQueue.disconnect(),
    ]);
    await prisma.$disconnect();
    for (const socket of smtpSockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
