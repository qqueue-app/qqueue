import { AlertTriangle, Trash2 } from "lucide-react";
import type { TemplateVariable } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface VariablesPanelProps {
  /** Declared variable definitions persisted on the template. */
  variables: TemplateVariable[];
  onVariablesChange: (next: TemplateVariable[]) => void;
  /** Sample values used only to render the preview. */
  previewData: Record<string, string>;
  onPreviewDataChange: (next: Record<string, string>) => void;
  /** Variable names actually referenced in the subject/body. */
  used: string[];
}

export function VariablesPanel({
  variables,
  onVariablesChange,
  previewData,
  onPreviewDataChange,
  used
}: VariablesPanelProps) {
  // One row per variable that is either declared or referenced in the content.
  const declaredNames = variables.map((variable) => variable.name);
  const names = [...new Set([...declaredNames, ...used])];

  function upsert(name: string, patch: Partial<TemplateVariable>) {
    const existing = variables.find((variable) => variable.name === name);
    if (existing) {
      onVariablesChange(
        variables.map((variable) =>
          variable.name === name ? { ...variable, ...patch } : variable
        )
      );
    } else {
      onVariablesChange([...variables, { name, ...patch }]);
    }
  }

  function remove(name: string) {
    onVariablesChange(variables.filter((variable) => variable.name !== name));
  }

  function setPreview(name: string, value: string) {
    onPreviewDataChange({ ...previewData, [name]: value });
  }

  if (names.length === 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground">
        No variables yet. Insert one with the{" "}
        <span className="font-medium">Variable</span> button in the toolbar, e.g.{" "}
        <code className="text-xs">{"{{firstName}}"}</code>.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Set a default for each variable so sends have a fallback, and a sample
        value to drive the live preview.
      </p>
      <div className="space-y-3">
        {names.map((name) => {
          const declared = variables.find((variable) => variable.name === name);
          const isUsed = used.includes(name);
          const undeclared = !declared;
          return (
            <div
              key={name}
              className="rounded-lg border bg-card p-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <code className="text-sm font-medium">{`{{${name}}}`}</code>
                <div className="flex items-center gap-1.5">
                  {!isUsed ? (
                    <Badge
                      variant="outline"
                      className="gap-1 text-amber-600 dark:text-amber-500"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      Unused
                    </Badge>
                  ) : null}
                  {undeclared ? (
                    <Badge variant="secondary">Auto</Badge>
                  ) : null}
                  {declared ? (
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() => remove(name)}
                      className="text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Default (sent)
                  </span>
                  <Input
                    value={declared?.defaultValue ?? ""}
                    placeholder="—"
                    onChange={(event) =>
                      upsert(name, { defaultValue: event.target.value })
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Sample (preview)
                  </span>
                  <Input
                    value={previewData[name] ?? ""}
                    placeholder={declared?.defaultValue || "—"}
                    onChange={(event) => setPreview(name, event.target.value)}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
