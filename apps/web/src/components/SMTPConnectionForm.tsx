import { FormEvent, ReactNode, useState } from "react";
import { Checkbox } from "./ui/checkbox.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";

export interface SMTPConnectionFormValues {
  name: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  isDefault: boolean;
}

// Well-known submission ports imply the TLS mode: 465 is implicit TLS,
// 587/25 (and the common dev/relay ports) start plaintext and upgrade via
// STARTTLS. Typing one of these syncs the Secure TLS checkbox; the user can
// still override it afterward.
const PORT_SECURE_DEFAULTS: Record<string, boolean> = {
  "25": false,
  "465": true,
  "587": false,
  "1025": false,
  "2525": false,
};

export const emptySMTPConnectionForm: SMTPConnectionFormValues = {
  name: "",
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
  fromEmail: "",
  fromName: "",
  isDefault: false,
};

interface SMTPConnectionFormProps {
  initial?: SMTPConnectionFormValues;
  /** Edit mode relaxes username/password to "leave blank to keep current". */
  editing?: boolean;
  /**
   * Rendered inside the <form> after the fields — put the submit button (and
   * any cancel/back action) here so it participates in form submission.
   */
  footer: ReactNode;
  onSubmit: (values: SMTPConnectionFormValues) => void | Promise<void>;
  /** Observe every field edit — used by the setup wizard to persist drafts. */
  onChange?: (values: SMTPConnectionFormValues) => void;
}

/**
 * The sending-account (SMTP) field grid, shared by the SMTPConnections page
 * dialog and the first-run setup wizard. Saving is verification: the API runs
 * an SMTP handshake before persisting, so a rejected submit means the details
 * didn't work, not that saving failed.
 */
export function SMTPConnectionForm({
  initial,
  editing = false,
  footer,
  onSubmit,
  onChange,
}: SMTPConnectionFormProps) {
  const [form, setForm] = useState<SMTPConnectionFormValues>(
    initial ?? emptySMTPConnectionForm
  );

  function update(patch: Partial<SMTPConnectionFormValues>) {
    const next = { ...form, ...patch };
    setForm(next);
    onChange?.(next);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
          required
        />
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div className="space-y-2">
          <Label htmlFor="host">Host</Label>
          <Input
            id="host"
            placeholder="smtp.example.com"
            value={form.host}
            onChange={(e) => update({ host: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            inputMode="numeric"
            value={form.port}
            onChange={(e) => {
              const port = e.target.value;
              const secure = PORT_SECURE_DEFAULTS[port];
              // One patch so onChange observers see the synced pair atomically.
              update(secure === undefined ? { port } : { port, secure });
            }}
            required
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="username">
            Username{editing ? " (optional)" : ""}
          </Label>
          <Input
            id="username"
            autoComplete="off"
            placeholder={editing ? "Keep current" : ""}
            value={form.username}
            onChange={(e) => update({ username: e.target.value })}
            required={!editing}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">
            Password{editing ? " (optional)" : ""}
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder={editing ? "Keep current" : ""}
            value={form.password}
            onChange={(e) => update({ password: e.target.value })}
            required={!editing}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fromEmail">From email</Label>
          <Input
            id="fromEmail"
            type="email"
            placeholder="hello@example.com"
            value={form.fromEmail}
            onChange={(e) => update({ fromEmail: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fromName">From name</Label>
          <Input
            id="fromName"
            value={form.fromName}
            onChange={(e) => update({ fromName: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <div className="space-y-1.5">
          <label
            htmlFor="smtp-secure"
            className="flex items-center gap-2.5 text-sm font-medium"
          >
            <Checkbox
              id="smtp-secure"
              checked={form.secure}
              onCheckedChange={(checked) => update({ secure: checked })}
            />
            Secure TLS
          </label>
          <p className="text-xs text-muted-foreground">
            Turn on for port 465 (implicit TLS). Leave off for 587 or 25 —
            those upgrade automatically with STARTTLS.
          </p>
        </div>
        <label
          htmlFor="smtp-default"
          className="flex items-center gap-2.5 text-sm font-medium"
        >
          <Checkbox
            id="smtp-default"
            checked={form.isDefault}
            onCheckedChange={(checked) => update({ isDefault: checked })}
          />
          Use as default sender
        </label>
      </div>
      {footer}
    </form>
  );
}
