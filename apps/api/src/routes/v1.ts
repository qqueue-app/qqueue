import { Router } from "express";
import { requireAuth } from "../middleware/require-auth.js";
import { apiKeyRouter } from "../modules/api-keys/routes.js";
import { authRouter } from "../modules/auth/routes.js";
import { campaignRouter } from "../modules/campaigns/routes.js";
import { contactListRouter } from "../modules/contact-lists/routes.js";
import { contactRouter } from "../modules/contacts/routes.js";
import { dashboardRouter } from "../modules/dashboard/routes.js";
import { organizationRouter } from "../modules/organizations/routes.js";
import { smtpConnectionRouter } from "../modules/smtp-connections/routes.js";
import { templateRouter } from "../modules/templates/routes.js";
import { trackingRouter } from "../modules/tracking/routes.js";
import { transactionalEmailRouter } from "../modules/transactional-email/routes.js";
import { webhookEndpointRouter } from "../modules/webhooks/routes.js";

export const v1Router = Router();

// Public auth endpoints (register/login/refresh).
v1Router.use("/auth", authRouter);

// Public analytics endpoints: open/click pixels hit by mail clients and ESP
// bounce webhooks, none of which carry an access token.
v1Router.use(trackingRouter);

// Transactional sends support either dashboard JWT auth or public API keys.
v1Router.use("/transactional-email", transactionalEmailRouter);

// Everything below requires a valid access token.
v1Router.use(requireAuth);
v1Router.use("/dashboard", dashboardRouter);
v1Router.use("/api-keys", apiKeyRouter);
v1Router.use("/organizations", organizationRouter);
v1Router.use("/smtp-connections", smtpConnectionRouter);
v1Router.use("/contacts", contactRouter);
v1Router.use("/contact-lists", contactListRouter);
v1Router.use("/templates", templateRouter);
v1Router.use("/campaigns", campaignRouter);
v1Router.use("/webhook-endpoints", webhookEndpointRouter);
