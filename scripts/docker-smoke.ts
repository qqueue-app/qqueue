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
}> {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  const server = createServer((socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let inData = false;
    let authLoginStep = 0;
    let pending = "";
    let messageLines: string[] = [];

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
            messageLines = [];
            socket.write("250 queued\r\n");
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
        } else if (
          upper.startsWith("MAIL FROM") ||
          upper.startsWith("RCPT TO") ||
          upper === "RSET" ||
          upper === "NOOP"
        ) {
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
      resolve({ server, port: address.port, sockets, messages });
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
    { emailSendingQueue },
    { campaignProcessingQueue },
    { webhookDeliveryQueue },
    { inboxSyncQueue },
  ] = await Promise.all([
    import("../apps/api/src/app.js"),
    import("../apps/api/src/lib/prisma.js"),
    import("../apps/worker/src/workers/email-sending.worker.js"),
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
  } = await startFakeSmtp();
  const worker = startEmailSendingWorker();
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
      !rawBody.includes("https://example.com/unsubscribe/signed-token")
    ) {
      throw new Error(
        "Smoke SMTP message is missing the one-click headers or footer"
      );
    }

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
      `Smoke test passed: ${sentJob.id} ${sentJob.status}; mailbox privacy, pagination, replies, disconnect, and migration drift verified`
    );
    process.exit(0);
  } finally {
    await worker.close(true);
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
  process.exitCode = 1;
});
