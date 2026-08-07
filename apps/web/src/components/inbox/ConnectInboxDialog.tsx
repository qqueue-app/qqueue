import { useState, type FormEvent } from "react";
import { Plug } from "lucide-react";
import { api, type InboxAccount } from "../../lib/api.js";
import { useApiMutation } from "../../lib/use-api.js";
import { qk } from "../../lib/query-client.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { Switch } from "../ui/switch.js";

const EMPTY = {
  name: "",
  email: "",
  host: "",
  port: "993",
  secure: true,
  username: "",
  password: "",
  mailbox: "INBOX",
};

/**
 * Connect an existing mailbox over IMAP so its replies appear in QQueue.
 *
 * Worth being explicit in the copy that the connection is read-only: people
 * are handing over a mailbox password, and "will this delete my mail?" is the
 * first question anyone sensible asks.
 */
export function ConnectInboxDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}) {
  const [form, setForm] = useState(EMPTY);

  const connect = useApiMutation(
    () =>
      api.createInboxAccount({
        organizationId,
        ...form,
        port: Number(form.port),
      }) as Promise<InboxAccount>,
    {
      successMessage: (account) => `Connected ${account.email}.`,
      errorMessage: "Couldn't connect that mailbox.",
      invalidates: [
        qk.inboxAccounts(organizationId),
        qk.inboundMessages(organizationId),
      ],
      onSuccess: () => {
        setForm(EMPTY);
        onOpenChange(false);
      },
    }
  );

  function set<K extends keyof typeof EMPTY>(
    key: K,
    value: (typeof EMPTY)[K]
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    connect.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect a mailbox</DialogTitle>
          <DialogDescription>
            QQueue opens your mailbox read-only — it never sends from it or
            deletes anything. You'll find these details under IMAP in your email
            provider's settings.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inbox-name">Name</Label>
              <Input
                id="inbox-name"
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="Support"
                required
              />
              <p className="text-meta text-muted-foreground">
                What you'll call it inside QQueue.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inbox-email">Email address</Label>
              <Input
                id="inbox-email"
                type="email"
                value={form.email}
                onChange={(event) => {
                  const email = event.target.value;
                  setForm((current) => ({
                    ...current,
                    email,
                    // Most providers use the address as the username; prefill it
                    // but leave it editable for the ones that don't.
                    username: current.username || email,
                  }));
                }}
                placeholder="support@yourcompany.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="inbox-host">Incoming mail server</Label>
              <Input
                id="inbox-host"
                placeholder="imap.gmail.com"
                value={form.host}
                onChange={(event) => set("host", event.target.value)}
                required
              />
              <p className="text-meta text-muted-foreground">
                Sometimes labelled "IMAP server".
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inbox-port">Port</Label>
              <Input
                id="inbox-port"
                inputMode="numeric"
                value={form.port}
                onChange={(event) => set("port", event.target.value)}
                required
              />
              <p className="text-meta text-muted-foreground">
                993 for almost everyone.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inbox-username">Username</Label>
              <Input
                id="inbox-username"
                value={form.username}
                onChange={(event) => set("username", event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="inbox-password">Password</Label>
              <Input
                id="inbox-password"
                type="password"
                value={form.password}
                onChange={(event) => set("password", event.target.value)}
                required
              />
              <p className="text-meta text-muted-foreground">
                If your provider uses app passwords, use one of those.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inbox-mailbox">Folder</Label>
              <Input
                id="inbox-mailbox"
                value={form.mailbox}
                onChange={(event) => set("mailbox", event.target.value)}
                required
              />
              <p className="text-meta text-muted-foreground">Usually INBOX.</p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-dialog border p-3">
              <div>
                <Label htmlFor="inbox-secure">Secure connection</Label>
                <p className="mt-1 text-meta text-muted-foreground">
                  Leave this on unless your provider says otherwise.
                </p>
              </div>
              <Switch
                id="inbox-secure"
                checked={form.secure}
                onCheckedChange={(secure) => set("secure", secure)}
                aria-label="Secure connection (TLS)"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={connect.isPending}>
              {connect.isPending ? <Spinner /> : <Plug className="h-4 w-4" />}
              Connect mailbox
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
