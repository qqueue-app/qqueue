import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { mailPreferenceController } from "./controller.js";
export const mailPreferenceRouter = Router();
mailPreferenceRouter.get(
  "/signatures",
  requireOrgMembership,
  mailPreferenceController.signatures
);
mailPreferenceRouter.put(
  "/signatures",
  requireOrgMembership,
  mailPreferenceController.saveSignature
);
