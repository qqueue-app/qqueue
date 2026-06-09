import { Router } from "express";
import { authRouter } from "../modules/auth/routes.js";
import { campaignRouter } from "../modules/campaigns/routes.js";
import { contactRouter } from "../modules/contacts/routes.js";
import { organizationRouter } from "../modules/organizations/routes.js";
import { smtpConnectionRouter } from "../modules/smtp-connections/routes.js";
import { templateRouter } from "../modules/templates/routes.js";
import { transactionalEmailRouter } from "../modules/transactional-email/routes.js";

export const v1Router = Router();

v1Router.use("/auth", authRouter);
v1Router.use("/organizations", organizationRouter);
v1Router.use("/smtp-connections", smtpConnectionRouter);
v1Router.use("/contacts", contactRouter);
v1Router.use("/templates", templateRouter);
v1Router.use("/campaigns", campaignRouter);
v1Router.use("/transactional-email", transactionalEmailRouter);
