/**
 * QQueue guided setup — `pnpm setup`.
 *
 * Prepares a working .env (generating all secrets), checks that Postgres,
 * Redis, and MinIO are reachable, and applies database migrations. Written for
 * someone who has never edited an env file: every value is explained in plain
 * language before anything is asked or changed, with links to the hosted docs.
 *
 * Idempotent: values that are already configured are never overwritten — only
 * empty or `change-me` placeholders are filled in. Re-running on a configured
 * .env just re-checks infrastructure and offers migrations.
 *
 * Flags:
 *   --yes                 non-interactive; accept defaults for everything
 *   --mode=local|production
 *   --domain=<domain>     production domain (implies --mode=production)
 *   --skip-infra          skip Postgres/Redis/MinIO reachability checks
 *   --skip-migrate        skip prisma generate + migrate
 *
 * Uses Node builtins only (run through the root devDependency `tsx`).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(repoRoot, ".env");
const envExamplePath = resolve(repoRoot, ".env.example");

const DOCS = {
  env: "https://qqueue.app/docs/environment-variables",
  infra: "https://qqueue.app/docs/managed-infrastructure",
  deploy: "https://qqueue.app/docs/deploy",
  quickstart: "https://qqueue.app/docs/quickstart",
  troubleshooting: "https://qqueue.app/docs/troubleshooting"
} as const;

// --- tiny output helpers (no deps) ---------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s: string) => (useColor ? `[1m${s}[22m` : s);
const ok = (s: string) => `  ✔ ${s}`;
const warn = (s: string) => `  ⚠ ${s}`;
const fail = (s: string) => `  ✖ ${s}`;

function heading(title: string) {
  console.log(`\n${bold(title)}\n${"-".repeat(title.length)}`);
}

function paragraph(text: string) {
  console.log(text);
}

// --- CLI flags -------------------------------------------------------------

interface Flags {
  yes: boolean;
  skipInfra: boolean;
  skipMigrate: boolean;
  mode?: "local" | "production";
  domain?: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { yes: false, skipInfra: false, skipMigrate: false };
  for (const arg of argv) {
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--skip-infra") flags.skipInfra = true;
    else if (arg === "--skip-migrate") flags.skipMigrate = true;
    else if (arg.startsWith("--mode=")) {
      const mode = arg.slice("--mode=".length);
      if (mode !== "local" && mode !== "production") {
        console.error(`Unknown --mode "${mode}" (use local or production).`);
        process.exit(1);
      }
      flags.mode = mode;
    } else if (arg.startsWith("--domain=")) {
      flags.domain = arg.slice("--domain=".length);
      flags.mode ??= "production";
    } else {
      console.error(`Unknown flag "${arg}". See scripts/setup.ts for usage.`);
      process.exit(1);
    }
  }
  return flags;
}

// --- .env file handling ------------------------------------------------------

/**
 * Line-oriented .env editing that keeps every comment and the original order.
 * Only `KEY=value` lines are touched, and only when we explicitly set a key.
 */
class EnvFile {
  private lines: string[];
  readonly changes: string[] = [];

  constructor(content: string) {
    this.lines = content.split("\n");
  }

  get(key: string): string | undefined {
    for (const line of this.lines) {
      if (line.startsWith(`${key}=`)) {
        return line.slice(key.length + 1).trim();
      }
    }
    return undefined;
  }

  set(key: string, value: string, changeNote?: string) {
    if (this.get(key) === value) {
      return;
    }
    const index = this.lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index === -1) {
      this.lines.push(`${key}=${value}`);
    } else {
      this.lines[index] = `${key}=${value}`;
    }
    this.changes.push(changeNote ?? key);
  }

  /** True when the value is missing, empty, or still a change-me placeholder. */
  isPlaceholder(key: string): boolean {
    const value = this.get(key);
    return value === undefined || value === "" || value.startsWith("change-me");
  }

  serialize(): string {
    return this.lines.join("\n");
  }
}

// --- reachability checks -----------------------------------------------------

function checkTcp(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function checkMinio(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/minio/health/live`, {
      signal: AbortSignal.timeout(3_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function parsePostgresUrl(url: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, port: Number(parsed.port || 5432) };
  } catch {
    return null;
  }
}

// --- main ---------------------------------------------------------------------

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  async function ask(question: string, fallback: string): Promise<string> {
    if (flags.yes) {
      return fallback;
    }
    const answer = (await rl.question(`  ${question}\n  [${fallback}] `)).trim();
    return answer || fallback;
  }

  async function confirm(question: string, fallback: boolean): Promise<boolean> {
    if (flags.yes) {
      return fallback;
    }
    const suffix = fallback ? "[Y/n]" : "[y/N]";
    const answer = (await rl.question(`  ${question} ${suffix} `)).trim().toLowerCase();
    if (answer === "") return fallback;
    return answer === "y" || answer === "yes";
  }

  console.log(bold("\nQQueue setup"));
  paragraph(
    "This walks you through everything QQueue needs to run. Nothing you've\n" +
      "already configured will be changed, and every value is explained as we\n" +
      `go. Full reference: ${DOCS.env}`
  );

  // 1. Ensure .env exists.
  if (!existsSync(envPath)) {
    if (!existsSync(envExamplePath)) {
      console.error(fail(".env.example is missing — is this a QQueue checkout?"));
      process.exit(1);
    }
    copyFileSync(envExamplePath, envPath);
    console.log(ok("Created .env from .env.example — your settings live in this file."));
  } else {
    console.log(ok("Found an existing .env — anything already configured stays as is."));
  }

  const env = new EnvFile(readFileSync(envPath, "utf8"));

  // 2. Deployment mode.
  heading("Where will this QQueue run?");
  paragraph(
    "Pick 'local' to try QQueue on this machine (the default — uses the\n" +
      "Docker services that ship with the repo). Pick 'production' to prepare\n" +
      `a real server with its own domain. Deployment guide: ${DOCS.deploy}`
  );
  const mode =
    flags.mode ??
    ((await ask("Set up for local development or production? (local/production)", "local")) ===
    "production"
      ? "production"
      : "local");

  // 3. Security keys (always machine-generated, never typed by a person).
  heading("Security keys");
  paragraph(
    "QQueue needs a few random secret keys to keep your server safe. You\n" +
      "never need to remember or type these — strong random ones are\n" +
      "generated now and saved in your .env file.\n\n" +
      "  • JWT_ACCESS_SECRET / JWT_REFRESH_SECRET — sign the login sessions\n" +
      "    for your dashboard, so only people with real passwords get in.\n" +
      "  • TRACKING_SECRET — a random password QQueue uses to sign the links\n" +
      "    that track email opens and clicks. If you ever change it, tracking\n" +
      "    in emails you've ALREADY sent will stop working.\n" +
      "  • ENCRYPTION_KEY — the key that locks the sending-account passwords\n" +
      "    you save inside QQueue. If this key is lost or changed, QQueue can\n" +
      "    no longer unlock any saved sending passwords and you will have to\n" +
      "    re-enter every one of them."
  );

  const secretKeys = [
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "ENCRYPTION_KEY",
    "TRACKING_SECRET"
  ] as const;
  let generated = 0;
  for (const key of secretKeys) {
    if (env.isPlaceholder(key)) {
      env.set(key, randomBytes(32).toString("hex"), `generated ${key}`);
      generated += 1;
    }
  }
  if (generated > 0) {
    console.log(ok(`Generated ${generated} secure key${generated === 1 ? "" : "s"} and saved them to .env.`));
    console.log(
      "  → Please back up your .env file somewhere safe (a password manager\n" +
        "    works well). It is the one file you cannot recreate later."
    );
  } else {
    console.log(ok("All security keys are already set — nothing changed."));
  }

  // 4. Mode-specific configuration.
  if (mode === "production") {
    heading("Your domain");
    paragraph(
      "This is the web address for this QQueue server. It appears inside the\n" +
        "emails you send (in open/click tracking links), so it must be a real\n" +
        "domain pointing at this machine before you go live. A sensible answer\n" +
        `looks like: mail.yourcompany.com — deployment guide: ${DOCS.deploy}`
    );
    const currentDomain = env.get("DOMAIN") || "mail.example.com";
    const domain = flags.domain ?? (await ask("What domain will this server run on?", currentDomain));
    env.set("DOMAIN", domain, "set DOMAIN");
    env.set("NODE_ENV", "production", "set NODE_ENV=production");
    console.log(
      warn(
        "Changing the domain later breaks tracking links in emails you've\n" +
          "    already sent. Pick the address you plan to keep."
      )
    );

    if (env.isPlaceholder("POSTGRES_PASSWORD")) {
      env.set("POSTGRES_PASSWORD", randomBytes(24).toString("hex"), "generated POSTGRES_PASSWORD");
      console.log(
        ok(
          "Generated a password for the bundled Postgres database. The\n" +
            "    production stack wires it up automatically — no action needed."
        )
      );
    }
    if (env.isPlaceholder("MINIO_ROOT_PASSWORD") || env.get("MINIO_ROOT_PASSWORD") === "qqueue-secret") {
      const minioPassword = randomBytes(24).toString("hex");
      env.set("MINIO_ROOT_PASSWORD", minioPassword, "generated MINIO_ROOT_PASSWORD");
      // The bundled MinIO logs in with this same password as its S3 secret.
      env.set("S3_SECRET_ACCESS_KEY", minioPassword, "matched S3_SECRET_ACCESS_KEY to MinIO");
      console.log(
        ok(
          "Generated a password for the bundled file storage (MinIO), used\n" +
            "    for email attachments. Kept its two settings in sync for you."
        )
      );
    }
    paragraph(
      "\nUsing your own hosted database, Redis, or storage instead of the\n" +
        "bundled ones? (Neon, Upstash, Cloudflare R2, and friends — free tiers\n" +
        `exist for all three.) See: ${DOCS.infra}`
    );
  } else {
    heading("Database (Postgres)");
    paragraph(
      "QQueue stores everything — contacts, emails, templates, settings — in\n" +
        "a Postgres database. If you're using the Docker services that come\n" +
        "with QQueue, the default below is already correct: just press Enter.\n" +
        "Don't have a database? You can get a free hosted one (e.g. Neon) in\n" +
        `about two minutes: ${DOCS.infra}`
    );
    const databaseUrl = await ask(
      "Where is your Postgres database?",
      env.get("DATABASE_URL") || "postgresql://qqueue:qqueue@localhost:5432/qqueue"
    );
    env.set("DATABASE_URL", databaseUrl, "set DATABASE_URL");

    heading("Redis");
    paragraph(
      "Redis is the queue QQueue uses to send email in the background and to\n" +
        "retry failures. The bundled Docker Redis is the default — press Enter\n" +
        `unless you run your own (hosted options: ${DOCS.infra}).`
    );
    const redis = await ask(
      "Where is your Redis server? (host:port)",
      `${env.get("REDIS_HOST") || "localhost"}:${env.get("REDIS_PORT") || "6379"}`
    );
    const [redisHost, redisPort] = redis.split(":");
    env.set("REDIS_HOST", redisHost || "localhost", "set REDIS_HOST");
    env.set("REDIS_PORT", redisPort || "6379", "set REDIS_PORT");
  }

  // 5. Optional inbound webhook secret.
  heading("Bounce notifications (optional)");
  paragraph(
    "If you send through a provider like SES or Postmark, it can notify\n" +
      "QQueue about bounces at a webhook URL, protected by a shared secret\n" +
      "(WEBHOOK_SECRET). Most self-hosted setups don't need this — QQueue\n" +
      "already detects bounces on its own for normal SMTP sending. You can\n" +
      "enable it later at any time."
  );
  if (env.isPlaceholder("WEBHOOK_SECRET")) {
    const wantsWebhook = await confirm("Generate a webhook secret now?", false);
    if (wantsWebhook) {
      env.set("WEBHOOK_SECRET", randomBytes(32).toString("hex"), "generated WEBHOOK_SECRET");
      console.log(ok("Generated WEBHOOK_SECRET — give this to your email provider's webhook settings."));
    } else {
      console.log(ok("Skipped — the inbound webhook endpoint stays disabled."));
    }
  } else {
    console.log(ok("A webhook secret is already configured — nothing changed."));
  }

  // 6. Save.
  writeFileSync(envPath, env.serialize());
  if (env.changes.length > 0) {
    console.log(`\n${ok(`Saved .env (${env.changes.length} change${env.changes.length === 1 ? "" : "s"}).`)}`);
  } else {
    console.log(`\n${ok("Your .env was already fully configured — nothing was changed.")}`);
  }

  // 7. Infrastructure reachability (local mode only — the production stack's
  // services live on a private Docker network and are checked by compose).
  const infra = { postgres: null as boolean | null, redis: null as boolean | null, minio: null as boolean | null };
  if (mode === "local" && !flags.skipInfra) {
    heading("Checking your services");
    paragraph("Making sure Postgres, Redis, and MinIO (file storage) are running and reachable...");

    async function runChecks() {
      const pg = parsePostgresUrl(env.get("DATABASE_URL") ?? "");
      infra.postgres = pg ? await checkTcp(pg.host, pg.port) : false;
      infra.redis = await checkTcp(env.get("REDIS_HOST") || "localhost", Number(env.get("REDIS_PORT") || 6379));
      infra.minio = await checkMinio(env.get("S3_ENDPOINT") || "http://localhost:9100");
    }

    await runChecks();
    const allUp = infra.postgres && infra.redis && infra.minio;
    if (!allUp) {
      for (const [name, up] of Object.entries(infra)) {
        console.log(up ? ok(`${name} is reachable`) : fail(`${name} is not reachable`));
      }
      const startDocker = await confirm(
        "Some services aren't running. Start them now with Docker? (runs `docker compose up -d`)",
        true
      );
      if (startDocker) {
        const result = spawnSync("docker", ["compose", "up", "-d"], {
          cwd: repoRoot,
          stdio: "inherit"
        });
        if (result.status !== 0) {
          console.log(
            fail(
              "Docker couldn't start the services. Is Docker Desktop running?\n" +
                `    Help: ${DOCS.troubleshooting}`
            )
          );
        } else {
          // Give the containers a few seconds to come up, then re-check.
          for (let attempt = 0; attempt < 10; attempt += 1) {
            await new Promise((r) => setTimeout(r, 1_500));
            await runChecks();
            if (infra.postgres && infra.redis && infra.minio) break;
          }
        }
      }
    }
    for (const [name, up] of Object.entries(infra)) {
      console.log(up ? ok(`${name} is reachable`) : warn(`${name} is still not reachable — ${DOCS.troubleshooting}`));
    }
  }

  // 8. Database migrations (local mode; production applies them in compose).
  let migrationsApplied = false;
  if (mode === "local" && !flags.skipMigrate) {
    heading("Preparing the database");
    paragraph(
      "QQueue creates its tables with database migrations. This is safe to\n" +
        "run repeatedly — it only applies what's missing."
    );
    if (infra.postgres === false) {
      console.log(warn("Skipping migrations because Postgres isn't reachable. Run `pnpm db:migrate` once it is."));
    } else {
      const generate = spawnSync("pnpm", ["db:generate"], { cwd: repoRoot, stdio: "inherit" });
      const migrate =
        generate.status === 0
          ? spawnSync("pnpm", ["db:migrate"], { cwd: repoRoot, stdio: "inherit" })
          : generate;
      if (migrate.status === 0) {
        migrationsApplied = true;
        console.log(ok("Database is ready."));
      } else {
        console.log(fail(`Migrations failed — see the output above. Help: ${DOCS.troubleshooting}`));
      }
    }
  }

  // 9. Summary.
  heading(mode === "local" ? "✅ QQueue is configured" : "✅ Ready to deploy");
  const summaryRows: Array<[string, string]> = [
    ["Settings file", ".env in this folder (back it up!)"],
    [
      "Security keys",
      generated > 0 ? `${generated} generated and saved in .env` : "already configured"
    ]
  ];
  if (mode === "local") {
    summaryRows.push(
      ["Database", `${env.get("DATABASE_URL") ?? ""}${infra.postgres ? "  (reachable ✓)" : ""}`],
      ["Redis", `${env.get("REDIS_HOST")}:${env.get("REDIS_PORT")}${infra.redis ? "  (reachable ✓)" : ""}`],
      ["File storage", `MinIO at ${env.get("S3_ENDPOINT")}${infra.minio ? "  (reachable ✓)" : ""}`],
      ["Migrations", migrationsApplied ? "applied ✓" : "not applied"]
    );
  } else {
    summaryRows.push(["Domain", env.get("DOMAIN") ?? ""]);
  }
  const labelWidth = Math.max(...summaryRows.map(([label]) => label.length)) + 2;
  for (const [label, value] of summaryRows) {
    console.log(`  ${label.padEnd(labelWidth)}${value}`);
  }

  console.log(`\n${bold("What happens next")}`);
  if (mode === "local") {
    paragraph(
      "  1. Start QQueue:        pnpm dev\n" +
        "  2. Open the dashboard:  http://localhost:5173\n" +
        "  3. The first time you open it, a short setup wizard helps you\n" +
        "     create your admin account and connect the mailbox QQueue\n" +
        "     sends from."
    );
  } else {
    paragraph(
      `  1. Point your domain's DNS (an A record for ${env.get("DOMAIN")}) at this server.\n` +
        "  2. Start the stack:  docker compose -f docker-compose.prod.yml up -d --build\n" +
        `  3. Open https://${env.get("DOMAIN")} — the setup wizard takes it from there.`
    );
  }

  console.log(`\n${bold("Things to remember")}`);
  paragraph(
    "  • Your settings live in the .env file in this folder. Keep a backup.\n" +
      "  • Never change ENCRYPTION_KEY or TRACKING_SECRET after you start\n" +
      "    sending — saved sending passwords and old tracking links would\n" +
      "    stop working.\n" +
      `  • Every setting explained: ${DOCS.env}\n` +
      `  • Stuck? ${DOCS.troubleshooting}`
  );

  rl.close();
}

main().catch((error) => {
  console.error("\nSetup hit an unexpected error:");
  console.error(error instanceof Error ? error.message : error);
  console.error(`Help: ${DOCS.troubleshooting}`);
  process.exit(1);
});
