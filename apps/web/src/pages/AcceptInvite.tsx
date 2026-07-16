import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, type InviteLookup } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { BrandMark } from "../components/BrandMark.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <BrandMark className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight">QQueue</span>
        </div>
        {children}
      </div>
    </main>
  );
}

export function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setSession } = useSession();
  const token = searchParams.get("token") ?? "";

  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once an existing account has been granted membership: they must sign in.
  const [joinedOrg, setJoinedOrg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadError("This invitation link is missing its token.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .lookupInvite(token)
      .then((result) => {
        if (!cancelled) setInvite(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "This invitation is invalid or has expired."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invite) return;

    if (!invite.hasAccount && password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    setPasswordError(null);
    setSubmitting(true);

    try {
      const result = await api.acceptInvite({
        token,
        password: invite.hasAccount ? undefined : password,
        name: name || undefined,
      });

      if (result.requiresSignIn) {
        // Existing account — membership granted, but we never issue tokens
        // without a verified password. Send them to sign in.
        setJoinedOrg(result.organization?.name ?? invite.organizationName);
        return;
      }

      if (result.user && result.tokens && result.organization) {
        setSession({
          user: result.user,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          currentOrganizationId: result.organization.id,
          organizations: [
            {
              id: result.organization.id,
              name: result.organization.name,
              role: result.role ?? "MEMBER",
            },
          ],
        });
        toast.success(`Welcome to ${result.organization.name}!`);
        navigate("/");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to accept invitation"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner />
            Checking your invitation…
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (loadError || !invite) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Invitation unavailable</CardTitle>
            <CardDescription>
              {loadError ?? "This invitation is invalid or has expired."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/login")}>
              Go to sign in
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (joinedOrg) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">You're in</CardTitle>
            <CardDescription>
              You've joined {joinedOrg}. Sign in with your existing account to
              continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/login")}>
              Go to sign in
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            Join {invite.organizationName}
          </CardTitle>
          <CardDescription>
            You've been invited to join{" "}
            <span className="font-medium">{invite.organizationName}</span> as{" "}
            {invite.role.toLowerCase()} using{" "}
            <span className="font-medium">{invite.email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit} noValidate>
            {invite.hasAccount ? (
              <p className="text-sm text-muted-foreground">
                You already have a QQueue account for this email. Accept to add
                this organization, then sign in as usual.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">Name (optional)</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Choose a password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={!!passwordError}
                  />
                  {passwordError ? (
                    <p className="text-xs text-destructive">{passwordError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      At least 8 characters.
                    </p>
                  )}
                </div>
              </>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Spinner /> : null}
              {invite.hasAccount ? "Accept invitation" : "Create account & join"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}
