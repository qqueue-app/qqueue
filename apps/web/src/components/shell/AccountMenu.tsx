import { Link, useNavigate } from "react-router-dom";
import { ChevronsUpDown, LogOut, Settings as SettingsIcon } from "lucide-react";
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
 * Signed-in user, with settings and sign-out behind it.
 *
 * Shared by the sidebar footer and the More sheet so "sign out" is one code
 * path regardless of which surface you reached it from.
 */
export function AccountMenu({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { user, signOut: clearSessionState } = useSession();

  function signOut() {
    clearSessionState();
    navigate("/login");
  }

  if (!user) {
    return (
      <Link
        to="/login"
        className={cn(
          "flex min-h-touch items-center justify-center rounded-control bg-primary px-3 text-ui font-medium text-primary-foreground transition-colors duration-fast ease-out hover:bg-primary-hover",
          className
        )}
      >
        Sign in
      </Link>
    );
  }

  const initial = user.email?.[0]?.toUpperCase() ?? "?";

  return (
    <Menu label="Account">
      <MenuTrigger
        className={cn(
          "flex min-h-touch w-full min-w-0 items-center gap-3 rounded-control px-2 py-2 text-left transition-colors duration-fast ease-out hover:bg-surface-sunken",
          className
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-identity-1-bg text-meta font-medium text-identity-1">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui font-medium text-text">
            {user.name ?? "Account"}
          </div>
          <div className="truncate text-meta text-text-secondary">
            {user.email}
          </div>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-text-tertiary" />
      </MenuTrigger>
      <MenuContent align="start" className="w-56">
        <MenuLabel className="truncate font-normal text-text-secondary">
          {user.email}
        </MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={() => navigate("/settings")}>
          <SettingsIcon className="h-4 w-4" />
          Settings
        </MenuItem>
        <MenuItem
          onSelect={signOut}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
