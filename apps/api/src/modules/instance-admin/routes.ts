import { Router } from "express";
import { requireInstanceAdmin } from "../../middleware/require-instance-admin.js";
import { instanceAdminController } from "./controller.js";

/**
 * Install-scope administration: every org on the instance, and the mail
 * infrastructure they share.
 *
 * Gated on `User.isInstanceAdmin` alone. Notably absent is
 * `requireOrgMembership` — these routes are not org-scoped, so there is no org
 * to be a member of. That is deliberate: the alternative, teaching the org
 * boundary to wave instance admins through, would have widened all 121 of its
 * call sites at once, including inbox and contacts. The boundary in
 * `lib/org-access.ts` stays absolute and this surface simply sits beside it.
 *
 * Domain and grant management lives here rather than on `/mailcow` because
 * Mailcow domains are instance-global: one API key, one mail server, shared by
 * everyone. Gating that on org OWNER meant gating it on nothing, since anyone
 * may create an org and own it.
 *
 * `:domain` is the domain name, URL-encoded.
 */
export const instanceAdminRouter = Router();

instanceAdminRouter.use(requireInstanceAdmin);

instanceAdminRouter.get(
  "/organizations",
  instanceAdminController.listOrganizations
);
instanceAdminRouter.get(
  "/organizations/:id",
  instanceAdminController.getOrganization
);

// Mailboxes and domain-grants are declared before `/domains/:domain` so no
// literal path can be swallowed by the parameterised one.
instanceAdminRouter.get("/mailboxes", instanceAdminController.listMailboxes);

instanceAdminRouter.get(
  "/domain-grants",
  instanceAdminController.listDomainGrants
);
instanceAdminRouter.post(
  "/domain-grants",
  instanceAdminController.addDomainGrant
);
instanceAdminRouter.delete(
  "/domain-grants/:id",
  instanceAdminController.removeDomainGrant
);

instanceAdminRouter.get("/mutes", instanceAdminController.listMutes);
instanceAdminRouter.post("/mutes", instanceAdminController.addMute);
instanceAdminRouter.delete("/mutes/:id", instanceAdminController.removeMute);

instanceAdminRouter.get("/domains", instanceAdminController.listDomains);
instanceAdminRouter.post("/domains", instanceAdminController.createDomain);
instanceAdminRouter.get(
  "/domains/:domain/dns",
  instanceAdminController.domainDns
);
instanceAdminRouter.post(
  "/domains/:domain/dkim",
  instanceAdminController.generateDomainDkim
);
instanceAdminRouter.put(
  "/domains/:domain/assignment",
  instanceAdminController.assignDomain
);
instanceAdminRouter.patch(
  "/domains/:domain",
  instanceAdminController.updateDomain
);
instanceAdminRouter.delete(
  "/domains/:domain",
  instanceAdminController.deleteDomain
);
