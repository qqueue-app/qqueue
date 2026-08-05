-- Instance-generated mail (password resets, invitations) now flows through the
-- shared EmailJob pipeline under its own origin so it can be identified and
-- exempted from suppression checks and tracking injection.
ALTER TYPE "EmailOrigin" ADD VALUE 'SYSTEM';
