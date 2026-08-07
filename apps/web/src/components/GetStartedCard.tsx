import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { DashboardSummary } from "../lib/api.js";
import { Button } from "./ui/button.js";
import { Card } from "./ui/card.js";
import { cn } from "../lib/utils.js";

interface GetStartedCardProps {
  summary: DashboardSummary | null;
  /** False while the first-run /setup wizard was started but never finished. */
  instanceSetupCompleted?: boolean;
}

/**
 * First-run guide, shown on the dashboard until the org has sent its first
 * email. It collapses full setup into the shortest path to a first send: a
 * recipient and a template are optional because Compose lets you type an
 * address and write inline, so the only hard prerequisite is a sending account.
 *
 * Steps are rows on one surface, not tiles inside the card — cards never nest
 * (§3), and three bordered boxes inside a bordered box made two optional
 * prerequisites look like three outstanding problems.
 */
export function GetStartedCard({
  summary,
  instanceSetupCompleted = true
}: GetStartedCardProps) {
  const steps = [
    ...(instanceSetupCompleted
      ? []
      : [
          {
            title: "Finish server setup",
            description:
              "Pick your registration policy and confirm sending works — it takes a minute.",
            done: false,
            cta: { label: "Resume setup", to: "/setup" }
          }
        ]),
    {
      title: "Connect a sending account",
      description:
        "Link a mailbox so QQueue can send on your behalf — works with Mailcow or any SMTP server.",
      done: Boolean(summary?.setup.hasSmtpConnection),
      cta: { label: "Connect", to: "/settings/sending" }
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
    <Card className="max-w-read p-6">
      <h2 className="text-section font-semibold text-text">
        Let’s send your first email
      </h2>
      <p className="mt-1 text-ui text-text-secondary">
        You’re a couple of quick steps away.
      </p>

      <ol className="mt-6 border-t border-border">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;

          return (
            <li
              key={step.title}
              className={cn(
                "flex flex-wrap items-center gap-4 border-b border-border py-4",
                // A step you can't start yet is dimmed rather than hidden: it
                // is what tells you how much is left.
                !isActive && !step.done && "opacity-60"
              )}
            >
              <div
                data-numeric
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-ui font-medium",
                  step.done
                    ? "bg-ok-bg text-ok"
                    : isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-sunken text-text-tertiary"
                )}
              >
                {step.done ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  index + 1
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-body font-medium text-text">
                  {step.title}
                </div>
                <p className="mt-1 text-ui leading-6 text-text-secondary">
                  {step.description}
                </p>
              </div>

              {step.done ? (
                <span className="text-ui text-ok">Done</span>
              ) : (
                <Button
                  asChild
                  size="sm"
                  variant={isActive ? "primary" : "secondary"}
                >
                  <Link to={step.cta.to}>{step.cta.label}</Link>
                </Button>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-meta text-text-tertiary">
        Optional next steps:{" "}
        <Link
          to="/contacts"
          className="rounded-control underline underline-offset-2 hover:text-text"
        >
          add contacts
        </Link>{" "}
        or{" "}
        <Link
          to="/templates"
          className="rounded-control underline underline-offset-2 hover:text-text"
        >
          create a template
        </Link>
        .
      </p>
    </Card>
  );
}
