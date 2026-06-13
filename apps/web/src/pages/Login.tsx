import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api.js";
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

type Mode = "login" | "register" | "forgot" | "reset";

interface LoginProps {
  mode: Mode;
}

type FieldErrors = Partial<Record<"email" | "password" | "token", string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Login({ mode }: LoginProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setSession } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!isReset && !emailPattern.test(email)) {
      next.email = "Enter a valid email address.";
    }
    if (isReset && !token) {
      next.token = "Reset token is required.";
    }
    if ((isRegister || isReset) && password.length < 8) {
      next.password = "Password must be at least 8 characters.";
    } else if (!isForgot && !password) {
      next.password = "Password is required.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validate()) {
      return;
    }
    setSubmitting(true);

    try {
      if (isForgot) {
        const result = await api.requestPasswordReset({ email });
        setResetToken(result.resetToken ?? null);
        toast.success(result.message);
      } else if (isReset) {
        await api.resetPassword({ token, password });
        toast.success("Password reset. Sign in with your new password.");
        navigate("/login");
      } else if (isRegister) {
        const result = await api.register({
          email,
          password,
          name: name || undefined,
          organizationName: organizationName || undefined,
        });
        setSession({
          user: result.user,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          currentOrganizationId: result.organization.id,
          organizations: [
            {
              id: result.organization.id,
              name: result.organization.name,
              role: "OWNER",
            },
          ],
        });
        toast.success(
          `Welcome to QQueue, ${result.user.name ?? result.user.email}!`
        );
      } else {
        const result = await api.login({ email, password });
        setSession({
          user: result.user,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          currentOrganizationId: result.organizations[0]?.id,
          organizations: result.organizations,
        });
        toast.success("Signed in.");
      }

      if (!isForgot && !isReset) {
        navigate("/");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Authentication failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <BrandMark className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight">QQueue</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              {isRegister
                ? "Create your account"
                : isForgot
                  ? "Reset your password"
                  : isReset
                    ? "Choose a new password"
                    : "Sign in"}
            </CardTitle>
            <CardDescription>
              {isRegister
                ? "Set up your first organization to get started."
                : isForgot
                  ? "Enter your account email to prepare a reset token."
                  : isReset
                    ? "Enter your reset token and new password."
                    : "Welcome back. Enter your details to continue."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit} noValidate>
              {!isReset ? (
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    aria-invalid={!!errors.email}
                  />
                  {errors.email ? (
                    <p className="text-xs text-destructive">{errors.email}</p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="token">Reset token</Label>
                  <Input
                    id="token"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    aria-invalid={!!errors.token}
                  />
                  {errors.token ? (
                    <p className="text-xs text-destructive">{errors.token}</p>
                  ) : null}
                </div>
              )}
              {!isForgot ? (
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={
                      isRegister || isReset
                        ? "new-password"
                        : "current-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={!!errors.password}
                  />
                  {errors.password ? (
                    <p className="text-xs text-destructive">
                      {errors.password}
                    </p>
                  ) : isRegister || isReset ? (
                    <p className="text-xs text-muted-foreground">
                      At least 8 characters.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {isRegister ? (
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
                    <Label htmlFor="organization">
                      Organization (optional)
                    </Label>
                    <Input
                      id="organization"
                      placeholder="Acme Inc."
                      value={organizationName}
                      onChange={(event) =>
                        setOrganizationName(event.target.value)
                      }
                    />
                  </div>
                </>
              ) : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Spinner /> : null}
                {isRegister
                  ? "Create account"
                  : isForgot
                    ? "Prepare reset"
                    : isReset
                      ? "Reset password"
                      : "Sign in"}
              </Button>
            </form>
            {resetToken ? (
              <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="font-medium">Development reset token</div>
                <code className="mt-2 block break-all rounded bg-background p-2 text-xs">
                  {resetToken}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() =>
                    navigate(
                      `/reset-password?token=${encodeURIComponent(resetToken)}`
                    )
                  }
                >
                  Continue
                </Button>
              </div>
            ) : null}
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {isRegister ? "Already have an account?" : "New to QQueue?"}{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  setErrors({});
                  navigate(isRegister ? "/login" : "/register");
                }}
              >
                {isRegister ? "Sign in" : "Create an account"}
              </button>
            </p>
            {!isRegister && !isForgot && !isReset ? (
              <p className="mt-2 text-center text-sm">
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => navigate("/forgot-password")}
                >
                  Forgot password?
                </button>
              </p>
            ) : null}
            {isForgot || isReset ? (
              <p className="mt-4 text-center text-sm">
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => navigate("/login")}
                >
                  Back to sign in
                </button>
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <Link
                to="/terms"
                className="hover:text-foreground hover:underline"
              >
                Terms
              </Link>
              <Link
                to="/privacy"
                className="hover:text-foreground hover:underline"
              >
                Privacy
              </Link>
              <Link
                to="/licensing"
                className="hover:text-foreground hover:underline"
              >
                Licensing
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
