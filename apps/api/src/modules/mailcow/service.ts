import { randomBytes } from "node:crypto";
import type {
  MailboxProvisionInput,
  MailboxProvisionResult,
  MailcowStatus,
} from "@qqueue/shared";
import { env } from "../../config/env.js";
import { encryptSecret } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { getMembership } from "../../lib/org-access.js";
import { prisma } from "../../lib/prisma.js";
import {
  normalizeDefault,
  smtpConnectionSelect,
  verifyConnection,
} from "../smtp-connections/service.js";
import { getMailcowClient, mailcowMailHost } from "./client.js";

/**
 * Mailbox provisioning (Phase 4): an OWNER/ADMIN creates a team mailbox from
 * QQueue. One flow yields the Mailcow mailbox, an app password held only by
 * QQueue, the SMTPConnection, the sync-enabled InboxAccount (mandatory — it
 * is what gives DSN parsing bounce visibility for this identity), and
 * optionally a send-as grant. Members never touch SMTP credentials or the
 * Mailcow UI; they read mail with the mailbox password in their own client.
 */

function generatePassword() {
  // 24 random bytes -> 32 base64url chars: length + mixed classes satisfies
  // Mailcow's default policy without ever needing human recall.
  return randomBytes(24).toString("base64url");
}

// Post-provision verification probe. Mailcow can take a moment to activate a
// fresh mailbox/app password, so a failed handshake right after creation is
// ambiguous — retry briefly, and report the outcome instead of failing the
// provisioning (rollback is reserved for "we couldn't record what we
// created", never "the SMTP handshake didn't work yet"). Short per-attempt
// timeout so the worst case (unreachable host) can't stall the request.
const VERIFY_PROBE_TIMEOUT_MS = 6_000;
const VERIFY_PROBE_DELAYS_MS = [0, 2_000, 5_000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeProvisionedConnection(connection: {
  host: string;
  port: number;
  secure: boolean;
  usernameEncrypted: string;
  passwordEncrypted: string;
}): Promise<boolean> {
  for (const delay of VERIFY_PROBE_DELAYS_MS) {
    if (delay > 0) {
      await sleep(delay);
    }
    try {
      await verifyConnection(connection, VERIFY_PROBE_TIMEOUT_MS);
      return true;
    } catch {
      // Try again after the next delay; the caller surfaces the final state.
    }
  }
  return false;
}

export const mailcowService = {
  /** Instance provisioning status + the domains a mailbox can live under. */
  async status(): Promise<MailcowStatus> {
    const client = getMailcowClient();
    const mailHost = mailcowMailHost();
    if (!client) {
      return { configured: false, reachable: false, domains: [], mailHost };
    }
    try {
      const domains = await client.listDomains();
      return {
        configured: true,
        reachable: true,
        domains: domains
          .filter((domain) => domain.active)
          .map((domain) => domain.domain_name),
        mailHost,
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        domains: [],
        mailHost,
        error:
          error instanceof Error ? error.message : "Unable to reach Mailcow",
      };
    }
  },

  async provision(
    input: MailboxProvisionInput
  ): Promise<MailboxProvisionResult> {
    const client = getMailcowClient();
    const mailHost = mailcowMailHost();
    if (!client || !mailHost) {
      throw new HttpError(
        404,
        "Mailcow provisioning is not configured on this instance",
        "mailcow_not_configured"
      );
    }

    const localPart = input.localPart.toLowerCase();
    const domain = input.domain.toLowerCase();
    const email = `${localPart}@${domain}`;

    // Everything that can fail cheaply fails before Mailcow is mutated.
    const domains = await client.listDomains();
    if (
      !domains.some(
        (candidate) =>
          candidate.active && candidate.domain_name.toLowerCase() === domain
      )
    ) {
      throw new HttpError(
        400,
        `${domain} is not an active domain on the Mailcow server`,
        "validation_error"
      );
    }

    if (input.assignToUserId) {
      const granteeMembership = await getMembership(
        input.assignToUserId,
        input.organizationId
      );
      if (!granteeMembership) {
        throw new HttpError(
          400,
          "The assignee is not a member of this organization",
          "validation_error"
        );
      }
    }

    const existingInbox = await prisma.inboxAccount.findUnique({
      where: {
        organizationId_email: {
          organizationId: input.organizationId,
          email,
        },
      },
      select: { id: true },
    });
    if (existingInbox) {
      throw new HttpError(
        409,
        `${email} is already connected to this organization`,
        "conflict"
      );
    }

    const mailboxPassword = generatePassword();
    const appPassword = generatePassword();

    await client.createMailbox({
      localPart,
      domain,
      name: input.name,
      password: mailboxPassword,
    });

    try {
      await client.createAppPassword({
        email,
        name: "QQueue",
        password: appPassword,
      });

      const usernameEncrypted = encryptSecret(email);
      const passwordEncrypted = encryptSecret(appPassword);

      const created = await prisma.$transaction(async (tx) => {
        const isDefault = await normalizeDefault(
          input.organizationId,
          undefined,
          tx
        );
        const connection = await tx.sMTPConnection.create({
          data: {
            organizationId: input.organizationId,
            name: input.name ?? email,
            host: mailHost,
            port: env.MAILCOW_SMTP_PORT,
            secure: true,
            usernameEncrypted,
            passwordEncrypted,
            fromEmail: email,
            fromName: input.name,
            isDefault,
          },
          select: smtpConnectionSelect,
        });
        const inbox = await tx.inboxAccount.create({
          data: {
            organizationId: input.organizationId,
            name: input.name ?? email,
            email,
            host: mailHost,
            port: env.MAILCOW_IMAP_PORT,
            secure: true,
            usernameEncrypted,
            passwordEncrypted,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (input.assignToUserId) {
          await tx.smtpConnectionGrant.create({
            data: {
              organizationId: input.organizationId,
              smtpConnectionId: connection.id,
              userId: input.assignToUserId,
            },
          });
        }
        return { connection, inbox };
      });

      // Non-fatal: everything is created and recorded; this only tells the
      // admin whether the credentials already work end to end.
      const verified = await probeProvisionedConnection({
        host: mailHost,
        port: env.MAILCOW_SMTP_PORT,
        secure: true,
        usernameEncrypted,
        passwordEncrypted,
      });

      return {
        smtpConnection: {
          ...created.connection,
          createdAt: created.connection.createdAt.toISOString(),
          updatedAt: created.connection.updatedAt.toISOString(),
        } as MailboxProvisionResult["smtpConnection"],
        inboxAccountId: created.inbox.id,
        email,
        mailboxPassword,
        verified,
      };
    } catch (error) {
      // The mailbox exists in Mailcow but QQueue's side failed: delete it so
      // provisioning never leaves an orphan that the next attempt trips over.
      // Cleanup is best-effort — the original error is the one that matters.
      await client.deleteMailbox(email).catch((cleanupError) => {
        console.error(
          `[mailcow] provisioning failed for ${email} and cleanup also failed — delete the mailbox in Mailcow by hand`,
          cleanupError
        );
      });
      throw error;
    }
  },
};
