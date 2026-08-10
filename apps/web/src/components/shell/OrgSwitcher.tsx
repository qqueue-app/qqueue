import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useSession } from "../../lib/session-context.js";
import { cn } from "../../lib/utils.js";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu.js";

/**
 * Organization picker.
 *
 * Lives in the sidebar on desktop and in the More sheet on a phone — the same
 * component in both, so switching org can never mean two different things.
 */
export function OrgSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate();
  const {
    user,
    organizations,
    currentOrganizationId,
    currentOrganization,
    setCurrentOrganizationId,
  } = useSession();

  if (!user) {
    return null;
  }

  // Mirrors the API rule: owning or administering any one organization is what
  // lets you start another. Someone who was only ever invited into other
  // people's organizations gets the switcher without the create item.
  const canCreateOrganization = organizations.some(
    (organization) =>
      organization.role === "OWNER" || organization.role === "ADMIN"
  );

  function switchOrganization(organizationId: string, name: string) {
    if (organizationId === currentOrganizationId) {
      return;
    }
    setCurrentOrganizationId(organizationId);
    toast.success(`Switched to ${name}.`);
  }

  return (
    <Menu label="Switch organization">
      <MenuTrigger
        className={cn(
          "flex min-h-touch w-full items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 text-left transition-colors duration-fast ease-out hover:bg-surface-sunken",
          className
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-accent text-meta font-semibold text-accent-foreground">
          {(currentOrganization?.name ?? "Q").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-eyebrow font-medium uppercase tracking-eyebrow text-text-tertiary">
            Organization
          </div>
          <div className="truncate text-ui font-medium text-text">
            {currentOrganization?.name ?? "Select organization"}
          </div>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-text-tertiary" />
      </MenuTrigger>
      <MenuContent align="start" className="w-56">
        <MenuLabel className="font-normal text-text-secondary">
          Switch organization
        </MenuLabel>
        <MenuSeparator />
        {organizations.length === 0 ? (
          <MenuItem disabled>No organizations</MenuItem>
        ) : (
          organizations.map((organization) => (
            <MenuItem
              key={organization.id}
              onSelect={() =>
                switchOrganization(organization.id, organization.name)
              }
            >
              <span className="flex-1 truncate">{organization.name}</span>
              {organization.id === currentOrganizationId ? (
                <Check className="h-4 w-4" />
              ) : null}
            </MenuItem>
          ))
        )}
        {canCreateOrganization ? (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => navigate("/settings/organization")}>
              <Plus className="h-4 w-4" />
              New organization
            </MenuItem>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}
