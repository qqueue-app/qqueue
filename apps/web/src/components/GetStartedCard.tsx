import { Link } from "react-router-dom";
import { CheckCircle2, Rocket } from "lucide-react";
import type { DashboardSummary } from "../lib/api.js";
import { Button } from "./ui/button.js";
import { Card, CardContent } from "./ui/card.js";
import { cn } from "../lib/utils.js";

interface GetStartedCardProps {
  summary: DashboardSummary | null;
}

// First-run guide shown on the dashboard until the org has sent its first
// email. It collapses full setup into the shortest path to a first send: a
// recipient and a template are optional because Compose lets you type an
// address and write inline, so the only hard prerequisite is a sending account.
export function GetStartedCard({ summary }: GetStartedCardProps) {
  const steps = [
    {
      title: "Connect a sending account",
      description:
        "Link a mailbox so QQueue can send on your behalf — works with Mailcow or any SMTP server.",
      done: Boolean(summary?.setup.hasSmtpConnection),
      cta: { label: "Connect", to: "/smtp-connections" }
    },
    {
      title: "Send your first email",
      description:
        "Write a message, type in a recipient, and hit send — no contacts or templates needed to start.",
      // Sending graduates the user out of onboarding entirely, so this step is
      // never shown as already done.
      done: false,
      cta: { label: "Compose", to: "/email-studio" }
    }
  ];

  const activeIndex = steps.findIndex((step) => !step.done);

  return (
    <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/[0.07] via-card to-card">
      <CardContent className="p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">
              Let’s send your first email
            </h2>
            <p className="text-sm text-muted-foreground">
              You’re a couple of quick steps away. We’ll guide you through it.
            </p>
          </div>
        </div>

        <ol className="mt-6 space-y-3">
          {steps.map((step, index) => {
            const isActive = index === activeIndex;
            const isLocked = activeIndex !== -1 && index > activeIndex;

            return (
              <li
                key={step.title}
                className={cn(
                  "flex items-start gap-4 rounded-xl border p-4 transition-colors",
                  step.done && "border-success/30 bg-success/[0.04]",
                  isActive && "border-primary/40 bg-primary/[0.04]",
                  isLocked && "opacity-60"
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                    step.done
                      ? "bg-success/15 text-success"
                      : isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {step.done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-medium">{step.title}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>

                {step.done ? (
                  <span className="flex items-center gap-1.5 self-center text-sm text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    Done
                  </span>
                ) : isLocked ? (
                  <Button size="sm" variant="outline" disabled>
                    {step.cta.label}
                  </Button>
                ) : (
                  <Button asChild size="sm">
                    <Link to={step.cta.to}>{step.cta.label}</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>

        <p className="mt-4 text-xs text-muted-foreground">
          Optional next steps:{" "}
          <Link
            to="/contacts"
            className="underline underline-offset-2 hover:text-foreground"
          >
            add contacts
          </Link>{" "}
          or{" "}
          <Link
            to="/templates"
            className="underline underline-offset-2 hover:text-foreground"
          >
            create a template
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
