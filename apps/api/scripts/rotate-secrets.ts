/**
 * Re-encrypt every stored secret with the keyring's current (first) key.
 *
 * Run after rotating the encryption key:
 *   1. Set ENCRYPTION_KEYS="<new-key>,<old-key>" (new first) on API + worker
 *      and restart both.
 *   2. `pnpm rotate-secrets` (from the repo root).
 *   3. Once it reports zero rows needing the old key, drop the old key:
 *      ENCRYPTION_KEYS="<new-key>".
 *
 * Also upgrades pre-keyring (legacy, unversioned) ciphertexts to the v1
 * envelope even when the key is unchanged. Idempotent — rows already on the
 * current key and envelope are skipped. Rows that no key in the ring can
 * decrypt are reported and left untouched: the credentials must be re-entered.
 */
import {
  decryptSecret,
  encryptSecret,
  needsRotation,
} from "../src/lib/crypto.js";
import { prisma } from "../src/lib/prisma.js";

interface SecretColumn {
  label: string;
  rows: () => Promise<Array<{ id: string; values: Record<string, string> }>>;
  update: (id: string, values: Record<string, string>) => Promise<unknown>;
}

const columns: SecretColumn[] = [
  {
    label: "SMTPConnection",
    rows: async () =>
      (
        await prisma.sMTPConnection.findMany({
          select: {
            id: true,
            usernameEncrypted: true,
            passwordEncrypted: true,
          },
        })
      ).map((row) => ({
        id: row.id,
        values: {
          usernameEncrypted: row.usernameEncrypted,
          passwordEncrypted: row.passwordEncrypted,
        },
      })),
    update: (id, values) =>
      prisma.sMTPConnection.update({ where: { id }, data: values }),
  },
  {
    label: "InboxAccount",
    rows: async () =>
      (
        await prisma.inboxAccount.findMany({
          select: {
            id: true,
            usernameEncrypted: true,
            passwordEncrypted: true,
          },
        })
      ).map((row) => ({
        id: row.id,
        values: {
          usernameEncrypted: row.usernameEncrypted,
          passwordEncrypted: row.passwordEncrypted,
        },
      })),
    update: (id, values) =>
      prisma.inboxAccount.update({ where: { id }, data: values }),
  },
  {
    label: "WebhookEndpoint",
    rows: async () =>
      (
        await prisma.webhookEndpoint.findMany({
          select: { id: true, secretEncrypted: true },
        })
      ).map((row) => ({
        id: row.id,
        values: { secretEncrypted: row.secretEncrypted },
      })),
    update: (id, values) =>
      prisma.webhookEndpoint.update({ where: { id }, data: values }),
  },
];

let rotated = 0;
let skipped = 0;
const failures: string[] = [];

for (const column of columns) {
  for (const row of await column.rows()) {
    const fresh: Record<string, string> = {};
    let touch = false;
    let failed = false;

    for (const [field, value] of Object.entries(row.values)) {
      try {
        if (!needsRotation(value)) {
          fresh[field] = value;
          continue;
        }
        fresh[field] = encryptSecret(decryptSecret(value));
        touch = true;
      } catch {
        failures.push(`${column.label} ${row.id} (${field})`);
        failed = true;
        break;
      }
    }

    if (failed) {
      continue;
    }
    if (touch) {
      await column.update(row.id, fresh);
      rotated += 1;
    } else {
      skipped += 1;
    }
  }
}

console.log(
  `rotate-secrets: ${rotated} row(s) re-encrypted, ${skipped} already current.`
);
if (failures.length > 0) {
  console.error(
    `rotate-secrets: ${failures.length} row(s) could not be decrypted with the current keyring — the credentials must be re-entered:\n  ${failures.join("\n  ")}`
  );
  process.exitCode = 1;
}

await prisma.$disconnect();
