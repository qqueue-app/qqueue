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
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function startFakeSmtp(): Promise<{
  server: Server;
  port: number;
  sockets: Set<Socket>;
}> {
  const sockets = new Set<Socket>();
  const server = createServer((socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let inData = false;
    let authLoginStep = 0;

    socket.write("220 qqueue-smoke ESMTP\r\n");
    socket.on("data", (chunk) => {
      for (const rawLine of chunk.toString("utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 queued\r\n");
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          socket.write("250-qqueue-smoke\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
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
      resolve({ server, port: address.port, sockets });
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
    "apps/api/prisma/schema"
  ]);

  run("pnpm", [
    "exec",
    "prisma",
    "migrate",
    "deploy",
    "--schema",
    "apps/api/prisma/schema"
  ]);

  const [
    { createApp },
    { prisma },
    { startEmailSendingWorker },
    { emailSendingQueue },
    { campaignProcessingQueue },
    { webhookDeliveryQueue }
  ] =
    await Promise.all([
      import("../apps/api/src/app.js"),
      import("../apps/api/src/lib/prisma.js"),
      import("../apps/worker/src/workers/email-sending.worker.js"),
      import("../apps/api/src/queues/email-sending.queue.js"),
      import("../apps/api/src/queues/campaign-processing.queue.js"),
      import("../apps/api/src/queues/webhook-delivery.queue.js")
    ]);

  const {
    server: smtpServer,
    port: smtpPort,
    sockets: smtpSockets
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
        organizationName: "Smoke Test"
      })
      .expect(201);

    const accessToken = register.body.data.tokens.accessToken as string;
    const organizationId = register.body.data.organization.id as string;
    const auth = `Bearer ${accessToken}`;

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
        isDefault: true
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
        scheduledAt
      })
      .expect(202);

    const emailJobId = send.body.data.id as string;
    const sentJob = await eventually(() =>
      prisma.emailJob.findFirst({
        where: { id: emailJobId, status: "SENT" },
        select: { id: true, status: true, messageId: true }
      })
    );

    console.log(`Smoke test passed: ${sentJob.id} ${sentJob.status}`);
    process.exit(0);
  } finally {
    await worker.close(true);
    await Promise.allSettled([
      emailSendingQueue.disconnect(),
      campaignProcessingQueue.disconnect(),
      webhookDeliveryQueue.disconnect()
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
