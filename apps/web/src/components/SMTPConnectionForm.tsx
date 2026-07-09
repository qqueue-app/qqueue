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
}: SMTPConnectionFormProps) {
  const [form, setForm] = useState<SMTPConnectionFormValues>(
    initial ?? emptySMTPConnectionForm
  );

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
          onChange={(e) => setForm({ ...form, name: e.target.value })}
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
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            inputMode="numeric"
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })}
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
            onChange={(e) => setForm({ ...form, username: e.target.value })}
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
            onChange={(e) => setForm({ ...form, password: e.target.value })}
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
            onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fromName">From name</Label>
          <Input
            id="fromName"
            value={form.fromName}
            onChange={(e) => setForm({ ...form, fromName: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <label
          htmlFor="smtp-secure"
          className="flex items-center gap-2.5 text-sm font-medium"
        >
          <Checkbox
            id="smtp-secure"
            checked={form.secure}
            onCheckedChange={(checked) => setForm({ ...form, secure: checked })}
          />
          Secure TLS
        </label>
        <label
          htmlFor="smtp-default"
          className="flex items-center gap-2.5 text-sm font-medium"
        >
          <Checkbox
            id="smtp-default"
            checked={form.isDefault}
            onCheckedChange={(checked) =>
              setForm({ ...form, isDefault: checked })
            }
          />
          Use as default sender
        </label>
      </div>
      {footer}
    </form>
  );
}
