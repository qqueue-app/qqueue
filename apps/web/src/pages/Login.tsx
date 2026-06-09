import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../components/ui/card.js";

type Mode = "login" | "register";

interface LoginProps {
  mode: Mode;
}

type FieldErrors = Partial<Record<"email" | "password" | "name", string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Login({ mode }: LoginProps) {
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!emailPattern.test(email)) {
      next.email = "Enter a valid email address.";
    }
    if (isRegister && password.length < 8) {
      next.password = "Password must be at least 8 characters.";
    } else if (!password) {
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
      if (isRegister) {
        const result = await api.register({
          email,
          password,
          name: name || undefined,
          organizationName: organizationName || undefined
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
              role: "OWNER"
            }
          ]
        });
        toast.success(`Welcome to QQueue, ${result.user.name ?? result.user.email}!`);
      } else {
        const result = await api.login({ email, password });
        setSession({
          user: result.user,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          currentOrganizationId: result.organizations[0]?.id,
          organizations: result.organizations
        });
        toast.success("Signed in.");
      }

      navigate("/");
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
            Q
          </div>
          <span className="text-xl font-semibold tracking-tight">QQueue</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              {isRegister ? "Create your account" : "Sign in"}
            </CardTitle>
            <CardDescription>
              {isRegister
                ? "Set up your first organization to get started."
                : "Welcome back. Enter your details to continue."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit} noValidate>
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
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={!!errors.password}
                />
                {errors.password ? (
                  <p className="text-xs text-destructive">{errors.password}</p>
                ) : isRegister ? (
                  <p className="text-xs text-muted-foreground">
                    At least 8 characters.
                  </p>
                ) : null}
              </div>
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
                    <Label htmlFor="organization">Organization (optional)</Label>
                    <Input
                      id="organization"
                      placeholder="Acme Inc."
                      value={organizationName}
                      onChange={(event) => setOrganizationName(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Spinner /> : null}
                {isRegister ? "Create account" : "Sign in"}
              </Button>
            </form>
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
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
