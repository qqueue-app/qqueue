import type { UserRole } from "@qqueue/shared";

declare global {
  namespace Express {
    interface Request {
      // Set by requireAuth once the access token is verified.
      userId?: string;
      userEmail?: string;
      // Set by requireOrgMembership once the caller is confirmed a member.
      organizationId?: string;
      orgRole?: UserRole;
    }
  }
}

export {};
