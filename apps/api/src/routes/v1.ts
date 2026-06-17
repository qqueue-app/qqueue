import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { apiKeyRouter } from "../modules/api-keys/routes.js";
import { attachmentRouter } from "../modules/attachments/routes.js";
import { authRouter } from "../modules/auth/routes.js";
import { campaignRouter } from "../modules/campaigns/routes.js";
import { contactListRouter } from "../modules/contact-lists/routes.js";
import { contactRouter } from "../modules/contacts/routes.js";
import { dashboardRouter } from "../modules/dashboard/routes.js";
import { deliverabilityRouter } from "../modules/deliverability/routes.js";
import { domainThrottleRouter } from "../modules/domain-throttles/routes.js";
import { emailDraftRouter } from "../modules/email-drafts/routes.js";
import { inboxRouter } from "../modules/inbox/routes.js";
import { manualEmailRouter } from "../modules/manual-email/routes.js";
import { organizationRouter } from "../modules/organizations/routes.js";
import { queueOperationsRouter } from "../modules/queue-operations/routes.js";
import { segmentRouter } from "../modules/segments/routes.js";
import { smtpConnectionRouter } from "../modules/smtp-connections/routes.js";
import { suppressionRouter } from "../modules/suppressions/routes.js";
import { templateRouter } from "../modules/templates/routes.js";
import { trackingRouter } from "../modules/tracking/routes.js";
import { transactionalEmailRouter } from "../modules/transactional-email/routes.js";
import { unsubscribeRouter } from "../modules/unsubscribe/routes.js";
import { webhookEndpointRouter } from "../modules/webhooks/routes.js";

export const v1Router = Router();

// Public auth endpoints (register/login/refresh).
v1Router.use("/auth", authRouter);

// Public analytics endpoints: open/click pixels hit by mail clients and ESP
// bounce webhooks, none of which carry an access token.
v1Router.use(trackingRouter);

// Public one-click unsubscribe (RFC 8058). Authorized by the signed token in the
// link, not a session — recipients aren't QQueue users.
v1Router.use(unsubscribeRouter);

// Transactional sends support either dashboard JWT auth or public API keys.
v1Router.use("/transactional-email", transactionalEmailRouter);

// Everything below requires a valid access token.
v1Router.use(requireAuth);
v1Router.use("/dashboard", dashboardRouter);
v1Router.use("/api-keys", apiKeyRouter);
v1Router.use("/organizations", organizationRouter);
v1Router.use("/queue-operations", queueOperationsRouter);
v1Router.use("/smtp-connections", smtpConnectionRouter);
v1Router.use("/contacts", contactRouter);
v1Router.use("/contact-lists", contactListRouter);
// Dynamic, rule-tree segments resolved to contacts at send time.
v1Router.use("/segments", segmentRouter);
// Org-wide suppression registry ("never send" list) consulted by the send
// pipeline; also written by bounce/complaint/unsubscribe handling.
v1Router.use("/suppressions", suppressionRouter);
// Per-recipient-domain send-rate caps enforced by the send worker.
v1Router.use("/domain-throttles", domainThrottleRouter);
// Deliverability dashboards (rates, per-domain, reputation alerts).
v1Router.use("/deliverability", deliverabilityRouter);
v1Router.use("/templates", templateRouter);
v1Router.use("/campaigns", campaignRouter);
// Email Studio: manual compose/preview/send and composer drafts. Both reuse the
// shared send pipeline (origin = MANUAL) rather than a parallel send path.
v1Router.use("/manual-email", manualEmailRouter);
v1Router.use("/email-drafts", emailDraftRouter);
// Email attachment upload/download/delete. Blobs live in object storage; the
// send pipeline links rows to the EmailJob and the worker streams them to SMTP.
v1Router.use("/attachments", attachmentRouter);
v1Router.use("/webhook-endpoints", webhookEndpointRouter);
// Inbox module: IMAP reply sync, assignment, notes, and reply-from-QQueue.
v1Router.use("/inbox", inboxRouter);
