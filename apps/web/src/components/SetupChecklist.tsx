import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { DashboardSummary } from "../lib/api.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";

export interface SetupStep {
  label: string;
  ready: boolean;
  /** Where you go to do it. */
  to: string;
}

/**
 * The four things an organization needs before it can send regularly, in the
 * order you would do them. Labels are the *action*, not the noun, because on
 * the dashboard each one is a button you press to go and do it.
 */
export function setupSteps(
  setup: DashboardSummary["setup"] | undefined
): SetupStep[] {
  return [
    {
      label: "Add a sending account",
      ready: Boolean(setup?.hasSmtpConnection),
      to: "/settings/sending",
    },
    {
      label: "Pick a default sender",
      ready: Boolean(setup?.hasDefaultSmtp),
      to: "/settings/sending",
    },
    {
      label: "Add contacts",
      ready: Boolean(setup?.hasContacts),
      to: "/contacts",
    },
    {
      label: "Create a template",
      ready: Boolean(setup?.hasTemplates),
      to: "/templates",
    },
  ];
}

interface SetupChecklistProps {
  steps: SetupStep[];
  /**
   * Render a "Setup complete" line instead of nothing once every step is done.
   *
   * Off on the dashboard, which someone opens dozens of times a day: four green
   * ticks confirming things they finished weeks ago is a permanent band of
   * noise above the numbers they actually came for. On for Settings, where
   * "did I ever finish this?" is a real question and the answer belongs.
   */
  showWhenComplete?: boolean;
}

/**
 * Setup state on one line: how many steps are left, and a button straight to
 * each of them. Only what is *missing* is listed — a done step is not a task.
 *
 * This replaces a 360px card holding four bordered rows that mostly said
 * "Ready". It was a third of the dashboard's first screen spent on a question
 * that is answered once and then never again.
 */
export function SetupChecklist({
  steps,
  showWhenComplete = false,
}: SetupChecklistProps) {
  const remaining = steps.filter((step) => !step.ready);

  if (remaining.length === 0) {
    if (!showWhenComplete) {
      return null;
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="ok">
          <Check aria-hidden />
          Setup complete
        </Badge>
        <span className="text-ui text-text-secondary">
          Everything needed to send regularly is configured.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Badge variant="warn">
        {steps.length - remaining.length}/{steps.length} ready
      </Badge>
      <span className="text-ui text-text-secondary">Still to set up:</span>
      <div className="flex flex-wrap items-center gap-2">
        {remaining.map((step) => (
          <Button key={step.label} asChild variant="secondary" size="sm">
            <Link to={step.to}>{step.label}</Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
