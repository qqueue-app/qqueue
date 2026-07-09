import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Globe, Lock, Mail, Rocket } from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "../components/BrandMark.js";
import {
  SMTPConnectionForm,
  emptySMTPConnectionForm,
  type SMTPConnectionFormValues,
} from "../components/SMTPConnectionForm.js";
import { ApiError, api, type SMTPConnection } from "../lib/api.js";
import {
  fetchSetupStatus,
  invalidateSetupStatus,
} from "../lib/setup-status.js";
import { useSession } from "../lib/session-context.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { cn } from "../lib/utils.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";

type SetupStep =
  | "resolving"
  | "welcome"
  | "account"
  | "smtp"
  | "policy"
  | "test-email"
  | "done";

const STEP_LABELS: Array<{ key: SetupStep; label: string }> = [
  { key: "account", label: "Admin account" },
  { key: "smtp", label: "Sending account" },
  { key: "policy", label: "Registration" },
  { key: "test-email", label: "Test email" },
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One-time first-run wizard. SetupGate routes every visit here while the
 * instance has zero users; after the first account exists the wizard is
 * resumable (visit /setup, or the Dashboard "finish setup" nudge) until
 * POST /setup/complete records the admin's registration-policy choice.
 */
export function Setup() {
  const navigate = useNavigate();
  const { user, currentOrganizationId, isAuthenticated, setSession } =
    useSession();

  const [step, setStep] = useState<SetupStep>("resolving");
  const [loadError, setLoadError] = useState(false);
  const [resuming, setResuming] = useState(false);

  // Account step state.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [creatingAccount, setCreatingAccount] = useState(false);

  // SMTP step state.
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpError, setSmtpError] = useState<string | null>(null);
  const [smtpConnection, setSmtpConnection] = useState<SMTPConnection | null>(
    null
  );

  // Policy + finish state.
  const [allowPublicRegistration, setAllowPublicRegistration] =
    useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSetupStatus(true)
      .then(async (status) => {
        if (cancelled) return;
        if (status.setupCompleted) {
          navigate("/", { replace: true });
          return;
        }
        if (status.needsSetup) {
          setStep("welcome");
          return;
        }
        // An admin exists but the wizard never finished. Resume it for the
        // signed-in admin; everyone else signs in first. The complete endpoint
        // enforces instance-admin server-side.
        if (!isAuthenticated) {
          toast.info("Sign in as the administrator to finish setup.");
          navigate("/login", { replace: true });
          return;
        }
        setResuming(true);
        if (currentOrganizationId) {
          try {
            const connections =
              await api.listSMTPConnections(currentOrganizationId);
            if (!cancelled && connections.length > 0) {
              setSmtpConnection(
                connections.find((c) => c.isDefault) ?? connections[0]
              );
              setStep("policy");
              return;
            }
          } catch {
            // Fall through to the SMTP step.
          }
        }
        if (!cancelled) {
          setStep("smtp");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!emailPattern.test(email)) {
      setAccountError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setAccountError("Password must be at least 8 characters.");
      return;
    }
    setAccountError(null);
    setCreatingAccount(true);
    try {
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
      invalidateSetupStatus();
      setStep("smtp");
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Unable to create the account"
      );
    } finally {
      setCreatingAccount(false);
    }
  }

  async function saveSmtp(form: SMTPConnectionFormValues) {
    if (!currentOrganizationId) {
      toast.error("Your session lost its organization — sign in again.");
      return;
    }
    setSavingSmtp(true);
    setSmtpError(null);
    try {
      const connection = await api.createSMTPConnection({
        organizationId: currentOrganizationId,
        name: form.name,
        host: form.host,
        port: Number(form.port),
        secure: form.secure,
        username: form.username,
        password: form.password,
        fromEmail: form.fromEmail,
        fromName: form.fromName || undefined,
        // The wizard's connection is the org default by definition.
        isDefault: true,
      });
      setSmtpConnection(connection);
      toast.success("Sending account verified and saved.");
      setStep("policy");
    } catch (error) {
      setSmtpError(
        error instanceof Error
          ? error.message
          : "We couldn't connect with these details."
      );
    } finally {
      setSavingSmtp(false);
    }
  }

  async function sendTestEmail() {
    if (!currentOrganizationId || !user?.email) {
      return;
    }
    setSendingTest(true);
    try {
      await api.sendManualEmail({
        organizationId: currentOrganizationId,
        to: [user.email],
        subject: "Your QQueue server is working",
        text: `Hi${user.name ? ` ${user.name}` : ""},\n\nThis is the test email from your new QQueue server. If you're reading it, sending works end to end.\n\n— QQueue`,
        ...(smtpConnection ? { smtpConnectionId: smtpConnection.id } : {}),
      });
      setTestSent(true);
      toast.success(`Test email sent to ${user.email}.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The test email could not be sent. You can retry from Email Studio later."
      );
    } finally {
      setSendingTest(false);
    }
  }

  async function finishSetup() {
    setCompleting(true);
    try {
      await api.completeSetup({ allowPublicRegistration });
    } catch (error) {
      // Someone (or another tab) already finished — that's success for us.
      if (!(error instanceof ApiError && error.status === 409)) {
        toast.error(
          error instanceof Error ? error.message : "Unable to finish setup"
        );
        setCompleting(false);
        return;
      }
    }
    invalidateSetupStatus();
    setCompleting(false);
    setStep("done");
  }

  const stepIndex = STEP_LABELS.findIndex((s) => s.key === step);

  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <BrandMark className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight">QQueue</span>
        </div>

        {stepIndex >= 0 ? (
          <div className="mb-4 flex items-center justify-center gap-2">
            {STEP_LABELS.map((s, index) => (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                    index < stepIndex
                      ? "bg-success/15 text-success"
                      : index === stepIndex
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {index < stepIndex ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    "hidden text-xs sm:inline",
                    index === stepIndex
                      ? "font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {step === "resolving" ? (
          loadError ? (
            <Alert variant="destructive">
              <AlertTitle>Cannot reach the API</AlertTitle>
              <AlertDescription>
                Make sure the QQueue API is running, then reload this page.
              </AlertDescription>
            </Alert>
          ) : (
            <Card>
              <CardContent className="space-y-3 p-6">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          )
        ) : null}

        {step === "welcome" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                Set up your QQueue server
              </CardTitle>
              <CardDescription>
                A few quick steps and you'll be sending email. Have the SMTP
                host, username, and password of the mailbox you send from
                ready.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Create the administrator account and your organization.
                </li>
                <li className="flex gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Connect the sending account (mailbox) QQueue sends from — we
                  verify it works before moving on.
                </li>
                <li className="flex gap-3">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Choose whether other people can register on this server.
                </li>
              </ul>
              <Button className="w-full" onClick={() => setStep("account")}>
                Start setup
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {step === "account" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                Create the administrator account
              </CardTitle>
              <CardDescription>
                This account manages the server: registration policy, sending
                accounts, and instance settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={createAccount} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="setup-email">Email</Label>
                  <Input
                    id="setup-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-password">Password</Label>
                  <Input
                    id="setup-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    At least 8 characters.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-name">Name (optional)</Label>
                  <Input
                    id="setup-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-organization">
                    Organization (optional)
                  </Label>
                  <Input
                    id="setup-organization"
                    placeholder="Acme Inc."
                    value={organizationName}
                    onChange={(event) =>
                      setOrganizationName(event.target.value)
                    }
                  />
                </div>
                {accountError ? (
                  <p className="text-sm text-destructive">{accountError}</p>
                ) : null}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={creatingAccount}
                >
                  {creatingAccount ? <Spinner /> : null}
                  Create account and continue
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {step === "smtp" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {resuming
                  ? "Welcome back — let's finish setting up"
                  : "Connect a sending account"}
              </CardTitle>
              <CardDescription>
                The mailbox QQueue sends from (works with Mailcow or any
                standard SMTP server). We test the connection before saving —
                nothing is stored unless it works.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {smtpError ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertTitle>We couldn't connect with these details</AlertTitle>
                  <AlertDescription>{smtpError}</AlertDescription>
                </Alert>
              ) : null}
              <SMTPConnectionForm
                initial={{
                  ...emptySMTPConnectionForm,
                  name: "Default sending account",
                  isDefault: true,
                }}
                onSubmit={saveSmtp}
                footer={
                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={savingSmtp}>
                      {savingSmtp ? <Spinner /> : null}
                      Test and continue
                    </Button>
                  </div>
                }
              />
            </CardContent>
          </Card>
        ) : null}

        {step === "policy" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                Who can register on this server?
              </CardTitle>
              <CardDescription>
                You can change this any time in Settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <button
                type="button"
                onClick={() => setAllowPublicRegistration(false)}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-colors",
                  !allowPublicRegistration
                    ? "border-primary/50 bg-primary/[0.05]"
                    : "hover:bg-muted/40"
                )}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Lock className="h-4 w-4 text-primary" />
                  Invite only (recommended)
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Registration stays closed. Only accounts you create or invite
                  can sign in — the right choice for a private server on the
                  open internet.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setAllowPublicRegistration(true)}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-colors",
                  allowPublicRegistration
                    ? "border-primary/50 bg-primary/[0.05]"
                    : "hover:bg-muted/40"
                )}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Globe className="h-4 w-4 text-primary" />
                  Anyone with the link can register
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Visitors can create their own account and organization on
                  this server. Choose this only if that's what you want.
                </p>
              </button>
              <Button className="w-full" onClick={() => setStep("test-email")}>
                Continue
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {step === "test-email" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Send yourself a test email</CardTitle>
              <CardDescription>
                Optional, but the fastest way to confirm the whole pipeline
                works — we'll send a short message to {user?.email ?? "you"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {testSent ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Test email sent</AlertTitle>
                  <AlertDescription>
                    Check the inbox for {user?.email}. Delivery can take a
                    moment.
                  </AlertDescription>
                </Alert>
              ) : (
                <Button
                  className="w-full"
                  onClick={sendTestEmail}
                  disabled={sendingTest}
                >
                  {sendingTest ? <Spinner /> : <Mail className="h-4 w-4" />}
                  Send test email to {user?.email ?? "me"}
                </Button>
              )}
              <Button
                className="w-full"
                variant={testSent ? "default" : "outline"}
                onClick={finishSetup}
                disabled={completing}
              >
                {completing ? <Spinner /> : null}
                {testSent ? "Finish setup" : "Skip and finish setup"}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {step === "done" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Your server is ready</CardTitle>
              <CardDescription>Here's what you configured:</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Administrator account{user?.email ? ` (${user.email})` : ""}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {smtpConnection
                    ? `Sending account "${smtpConnection.name}" verified`
                    : "Sending account connected"}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Registration{" "}
                  {allowPublicRegistration ? "open to visitors" : "invite only"}
                </li>
              </ul>
              <p className="text-sm text-muted-foreground">
                Next up: add contacts, create a template, or head straight to
                Email Studio and send something real.
              </p>
              <Button className="w-full" onClick={() => navigate("/")}>
                Go to dashboard
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
