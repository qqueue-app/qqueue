import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Globe,
  HelpCircle,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  MailDnsProvider,
  MailDnsRecord,
  MailDomainDnsStatus,
  MailDomainSummary,
} from "../../lib/api.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import {
  DataGrid,
  type DataGridColumn,
} from "../ui/data-grid.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { EmptyState } from "../EmptyState.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { RowActions } from "../ui/row-actions.js";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.js";
import { Switch } from "../ui/switch.js";
import { Hint } from "../ui/tooltip.js";

/**
 * Domains — the mail server's domains, as an owner sees them.
 *
 * The panel's real job is not the create form, which is one API call. It is
 * the DNS drawer: a domain exists in Mailcow the moment it is created but
 * neither sends nor receives until MX, SPF, DKIM and DMARC are published, so
 * "created" and "working" are different states and the UI has to say which one
 * you are in. Everything else here is in service of getting to a green
 * checklist.
 */

const PROVIDER_LABELS: Record<MailDnsProvider, string> = {
  CLOUDFLARE: "Cloudflare",
  ROUTE53: "AWS Route 53",
  GODADDY: "GoDaddy",
  NAMECHEAP: "Namecheap",
  GOOGLE: "Google",
  DIGITALOCEAN: "DigitalOcean",
  VULTR: "Vultr",
  HETZNER: "Hetzner",
  LINODE: "Linode",
  NS1: "NS1",
  DNSIMPLE: "DNSimple",
  NAMECOM: "Name.com",
  PORKBUN: "Porkbun",
  AZURE: "Azure DNS",
  OTHER: "your DNS host",
  UNKNOWN: "your DNS host",
};

/** Where to go to add the records, for the hosts whose path is unambiguous. */
const PROVIDER_HINTS: Partial<Record<MailDnsProvider, string>> = {
  CLOUDFLARE: "Cloudflare dashboard → your domain → DNS → Records.",
  ROUTE53: "Route 53 → Hosted zones → your domain → Create record.",
  GODADDY: "GoDaddy → Domain settings → DNS → Manage zones.",
  NAMECHEAP: "Namecheap → Domain List → Manage → Advanced DNS.",
  DIGITALOCEAN: "DigitalOcean → Networking → Domains → your domain.",
  PORKBUN: "Porkbun → Domain management → DNS records.",
};

function formatBytes(bytes: number) {
  if (bytes <= 0) return "Unlimited";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

async function copyValue(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Couldn't copy — select the value and copy it manually.");
  }
}

/** One DNS record row: what to publish, and whether it is already live. */
function DnsRecordRow({ record }: { record: MailDnsRecord }) {
  const status = record.status ?? "UNKNOWN";
  return (
    <div className="rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{record.type}</Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-meta">
          {record.name}
        </span>
        {status === "OK" ? (
          <Badge variant="success">
            <Check className="h-3 w-3" />
            Live
          </Badge>
        ) : status === "MISSING" ? (
          <Badge variant={record.required ? "destructive" : "secondary"}>
            {record.required ? "Missing" : "Optional"}
          </Badge>
        ) : (
          <Hint label="QQueue couldn't complete the DNS lookup, so this says nothing about your zone.">
            <Badge variant="secondary" className="cursor-help">
              Unchecked
            </Badge>
          </Hint>
        )}
      </div>

      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-control bg-surface px-3 py-2 text-meta text-text">
          {record.priority !== undefined ? `${record.priority} ` : ""}
          {record.value}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => copyValue(record.value)}
        >
          <Copy className="h-4 w-4" />
          Copy
        </Button>
      </div>

      <p className="mt-2 text-meta text-muted-foreground">{record.purpose}</p>
    </div>
  );
}

/**
 * The DNS drawer for one domain.
 *
 * Records are listed whatever their state, never filtered down to the missing
 * ones: an owner comparing their zone against this list needs the whole set in
 * a stable order, and a record that disappears once it goes green is a record
 * they can no longer check.
 */
function DomainDnsSheet({
  domain,
  dns,
  loading,
  onOpenChange,
  onRefresh,
  onGenerateDkim,
  generatingDkim,
}: {
  domain: string | null;
  dns: MailDomainDnsStatus | undefined;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onGenerateDkim: () => void;
  generatingDkim: boolean;
}) {
  const hasDkimRecord = dns?.records.some((record) => record.key === "dkim");

  return (
    <Sheet open={domain !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>DNS for {domain}</SheetTitle>
          <SheetDescription>
            Publish these at your DNS host. Until the required records are live,
            this domain can neither receive mail nor pass authentication when it
            sends.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          {loading ? (
            <p className="text-body text-muted-foreground">
              Checking DNS…
            </p>
          ) : !dns ? (
            <p className="text-body text-muted-foreground">
              Couldn&apos;t load the DNS status for this domain.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {dns.ready ? (
                  <Badge variant="success">
                    <ShieldCheck className="h-3 w-3" />
                    All required records live
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertTriangle className="h-3 w-3" />
                    Not ready yet
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onRefresh}
                >
                  <RefreshCw className="h-4 w-4" />
                  Re-check
                </Button>
              </div>

              {/* Detected from live NS records, so it is a fact rather than a
                  guess — worth saying out loud, because "where do I even put
                  these" is the step that actually stalls people. */}
              {dns.provider !== "UNKNOWN" ? (
                <div className="rounded-control border border-border bg-surface p-3">
                  <p className="text-body">
                    Your DNS is hosted at{" "}
                    <span className="font-medium">
                      {PROVIDER_LABELS[dns.provider]}
                    </span>
                    .
                  </p>
                  {PROVIDER_HINTS[dns.provider] ? (
                    <p className="mt-1 text-meta text-muted-foreground">
                      {PROVIDER_HINTS[dns.provider]}
                    </p>
                  ) : null}
                  {dns.nameservers.length > 0 ? (
                    <p className="mt-1 font-mono text-meta text-muted-foreground">
                      {dns.nameservers.join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-control border border-border bg-surface p-3">
                  <p className="text-body text-muted-foreground">
                    QQueue couldn&apos;t read this domain&apos;s nameservers. If
                    you registered it moments ago that is expected — it just
                    hasn&apos;t propagated yet.
                  </p>
                </div>
              )}

              {!hasDkimRecord ? (
                <div className="rounded-control border border-border p-3">
                  <p className="text-body">
                    No DKIM key yet, so mail from this domain goes out
                    unsigned.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={onGenerateDkim}
                    disabled={generatingDkim}
                  >
                    <KeyRound className="h-4 w-4" />
                    {generatingDkim ? "Generating…" : "Generate DKIM key"}
                  </Button>
                </div>
              ) : null}

              <div className="space-y-2">
                {dns.records.map((record) => (
                  <DnsRecordRow key={record.key} record={record} />
                ))}
              </div>

              <p className="text-meta text-muted-foreground">
                DNS changes can take up to an hour to propagate — longer if your
                zone has a high TTL. &ldquo;Missing&rdquo; right after you add a
                record usually just means it hasn&apos;t propagated yet.
              </p>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export interface MailDomainFormValues {
  domain: string;
  description: string;
  maxMailboxes: string;
  defaultQuotaMiB: string;
  active: boolean;
}

const EMPTY_FORM: MailDomainFormValues = {
  domain: "",
  description: "",
  maxMailboxes: "",
  defaultQuotaMiB: "",
  active: true,
};

/**
 * Create/edit dialog. Blank numeric fields are omitted from the payload rather
 * than sent as 0 — Mailcow reads 0 as "unlimited", so a blank field must mean
 * "leave the server's own default alone", not "remove the limit".
 */
function DomainFormDialog({
  open,
  editing,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  editing: MailDomainSummary | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: MailDomainFormValues) => void;
}) {
  const [values, setValues] = useState<MailDomainFormValues>(EMPTY_FORM);
  // Re-seed whenever the dialog opens for a different subject.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const subject = editing?.domain ?? (open ? "__new__" : null);
  if (open && seededFor !== subject) {
    setSeededFor(subject);
    setValues(
      editing
        ? {
            domain: editing.domain,
            description: editing.description,
            maxMailboxes: editing.maxMailboxes
              ? String(editing.maxMailboxes)
              : "",
            defaultQuotaMiB: editing.defaultQuotaBytes
              ? String(Math.round(editing.defaultQuotaBytes / 1024 / 1024))
              : "",
            active: editing.active,
          }
        : EMPTY_FORM
    );
  }
  if (!open && seededFor !== null) {
    setSeededFor(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(values);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.domain}` : "Add a domain"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Change what this domain allows. The domain name itself can't be changed — delete and re-add to rename."
                : "Adds the domain to your mail server. You'll get the DNS records to publish as soon as it's created."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="domain-name">Domain</Label>
              <Input
                id="domain-name"
                value={values.domain}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, domain: event.target.value }))
                }
                placeholder="example.com"
                autoComplete="off"
                disabled={editing !== null}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="domain-description">Description</Label>
              <Input
                id="domain-description"
                value={values.description}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Optional label"
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="domain-max-mailboxes">Max mailboxes</Label>
                <Input
                  id="domain-max-mailboxes"
                  type="number"
                  min={0}
                  value={values.maxMailboxes}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      maxMailboxes: event.target.value,
                    }))
                  }
                  placeholder="Server default"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="domain-default-quota">
                  Default mailbox quota (MB)
                </Label>
                <Input
                  id="domain-default-quota"
                  type="number"
                  min={0}
                  value={values.defaultQuotaMiB}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      defaultQuotaMiB: event.target.value,
                    }))
                  }
                  placeholder="Server default"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-control border border-border p-3">
              <div>
                <Label htmlFor="domain-active">Accept mail</Label>
                <p className="mt-0.5 text-meta text-muted-foreground">
                  Turn off to stop the server accepting mail for this domain
                  without deleting anything.
                </p>
              </div>
              <Switch
                id="domain-active"
                checked={values.active}
                onCheckedChange={(checked) =>
                  setValues((prev) => ({ ...prev, active: checked }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? editing
                  ? "Saving…"
                  : "Adding…"
                : editing
                  ? "Save changes"
                  : "Add domain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete confirmation. Retyping the domain is the point: this destroys the
 * domain on the shared mail server, and the API refuses it while any mailbox
 * still exists, so the dialog says so before the request rather than after.
 */
function DeleteDomainDialog({
  domain,
  pending,
  onOpenChange,
  onConfirm,
}: {
  domain: MailDomainSummary | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (confirm: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (domain && seededFor !== domain.domain) {
    setSeededFor(domain.domain);
    setTyped("");
  }
  if (!domain && seededFor !== null) {
    setSeededFor(null);
  }

  const blocked = (domain?.mailboxCount ?? 0) > 0;

  return (
    <Dialog open={domain !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {domain?.domain}?</DialogTitle>
          <DialogDescription>
            This removes the domain from your mail server. Mail sent to it will
            bounce from that moment on.
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <div className="flex items-start gap-3 rounded-control border border-destructive/40 p-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="text-body">
              {domain?.domain} still has {domain?.mailboxCount} mailbox
              {domain?.mailboxCount === 1 ? "" : "es"}. Delete those first —
              removing the domain would destroy every message in them.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 py-2">
            <Label htmlFor="delete-domain-confirm">
              Type <span className="font-mono">{domain?.domain}</span> to
              confirm
            </Label>
            <Input
              id="delete-domain-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={blocked || pending || typed !== domain?.domain}
            onClick={() => onConfirm(typed)}
          >
            {pending ? "Deleting…" : "Delete domain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface MailDomainsPanelProps {
  domains: MailDomainSummary[];
  loading: boolean;
  /** Null unless a DNS drawer is open. */
  dnsDomain: string | null;
  dns: MailDomainDnsStatus | undefined;
  dnsLoading: boolean;
  pending: {
    save: boolean;
    delete: boolean;
    dkim: boolean;
  };
  onOpenDns: (domain: string | null) => void;
  onRefreshDns: () => void;
  onGenerateDkim: (domain: string) => void;
  onCreate: (values: MailDomainFormValues) => void;
  onUpdate: (domain: string, values: MailDomainFormValues) => void;
  onClaim: (domain: MailDomainSummary) => void;
  onDelete: (domain: string, confirm: string) => void;
}

export function MailDomainsPanel({
  domains,
  loading,
  dnsDomain,
  dns,
  dnsLoading,
  pending,
  onOpenDns,
  onRefreshDns,
  onGenerateDkim,
  onCreate,
  onUpdate,
  onClaim,
  onDelete,
}: MailDomainsPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MailDomainSummary | null>(null);
  const [deleting, setDeleting] = useState<MailDomainSummary | null>(null);

  const columns = useMemo<DataGridColumn<MailDomainSummary>[]>(
    () => [
      {
        accessorKey: "domain",
        header: "Domain",
        meta: { title: "Domain" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.original.domain}</span>
              {row.original.ownership === "UNCLAIMED" ? (
                <Hint label="This domain is on the mail server but no organization has claimed it. Claim it to keep it out of other organizations' view.">
                  <Badge variant="secondary" className="cursor-help">
                    Unclaimed
                  </Badge>
                </Hint>
              ) : null}
              {!row.original.active ? (
                <Hint label="Your mail server is refusing mail for this domain">
                  <Badge variant="destructive" className="cursor-help">
                    Not accepting mail
                  </Badge>
                </Hint>
              ) : null}
              {row.original.backupmx ? (
                <Badge variant="secondary">Backup MX</Badge>
              ) : null}
            </div>
            {row.original.description ? (
              <div className="truncate text-meta text-muted-foreground">
                {row.original.description}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "mailboxCount",
        header: "Mailboxes",
        meta: { title: "Mailboxes", align: "right", hideBelowMd: true },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.mailboxCount}
            {row.original.maxMailboxes
              ? ` of ${row.original.maxMailboxes}`
              : ""}
          </span>
        ),
      },
      {
        id: "quota",
        header: "Default quota",
        meta: { title: "Default quota", hideBelowLg: true },
        accessorFn: (row) => row.defaultQuotaBytes,
        cell: ({ row }) => (
          <span className="text-meta text-muted-foreground">
            {formatBytes(row.original.defaultQuotaBytes)}
          </span>
        ),
      },
      {
        id: "dkim",
        header: "DKIM",
        meta: { title: "DKIM", align: "center", hideBelowMd: true },
        accessorFn: (row) => (row.hasDkim ? 1 : 0),
        cell: ({ row }) =>
          row.original.hasDkim ? (
            <Hint label="Your mail server holds a DKIM key for this domain. Check the DNS panel to confirm the record is published.">
              <Badge variant="secondary" className="cursor-help">
                <KeyRound className="h-3 w-3" />
                Key set
              </Badge>
            </Hint>
          ) : (
            <Hint label="No DKIM key — mail from this domain sends unsigned.">
              <span className="cursor-help text-body text-muted-foreground">
                —
              </span>
            </Hint>
          ),
      },
      {
        id: "actions",
        header: "",
        meta: { pinned: true, align: "right" },
        cell: ({ row }) => (
          <RowActions
            rowLabel={row.original.domain}
            actions={[
              {
                label: "DNS records",
                icon: Globe,
                primary: true,
                onSelect: () => onOpenDns(row.original.domain),
              },
              {
                label: "Claim for this organization",
                icon: ShieldCheck,
                hidden: row.original.ownership !== "UNCLAIMED",
                onSelect: () => onClaim(row.original),
              },
              {
                label: "Edit domain",
                icon: Pencil,
                onSelect: () => {
                  setEditing(row.original);
                  setFormOpen(true);
                },
              },
              {
                label: "Delete domain",
                icon: Trash2,
                destructive: true,
                onSelect: () => setDeleting(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [onClaim, onOpenDns]
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add domain
        </Button>
      </div>

      <DataGrid
        label="Domains"
        data={domains}
        columns={columns}
        getRowId={(row) => row.domain}
        loading={loading}
        searchPlaceholder="Search domains…"
        getRowLabel={(row) => row.domain}
        empty={
          <Card>
            <EmptyState
              icon={Globe}
              title="No domains on your mail server yet"
              description="Add one here and QQueue will show you exactly which DNS records to publish to make it work."
            />
          </Card>
        }
        renderMobileRow={(row) => (
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.domain}</span>
              {row.ownership === "UNCLAIMED" ? (
                <Badge variant="secondary">Unclaimed</Badge>
              ) : null}
              {!row.active ? (
                <Badge variant="destructive">Not accepting mail</Badge>
              ) : null}
            </div>
            <div className="text-meta text-muted-foreground">
              {row.mailboxCount} mailbox{row.mailboxCount === 1 ? "" : "es"} ·{" "}
              {row.hasDkim ? "DKIM key set" : "No DKIM key"}
            </div>
          </div>
        )}
      />

      <Card className="mt-3">
        <CardContent className="flex items-start gap-3 p-card">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-meta text-muted-foreground">
            Adding a domain here creates it on the mail server this whole
            instance shares. It starts working only once its DNS records are
            published — open <span className="font-medium">DNS records</span> on
            any domain to see what is still missing.
          </p>
        </CardContent>
      </Card>

      <DomainFormDialog
        open={formOpen}
        editing={editing}
        pending={pending.save}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        onSubmit={(values) => {
          if (editing) {
            onUpdate(editing.domain, values);
          } else {
            onCreate(values);
          }
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <DeleteDomainDialog
        domain={deleting}
        pending={pending.delete}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={(confirm) => {
          if (deleting) onDelete(deleting.domain, confirm);
          setDeleting(null);
        }}
      />

      <DomainDnsSheet
        domain={dnsDomain}
        dns={dns}
        loading={dnsLoading}
        generatingDkim={pending.dkim}
        onOpenChange={(open) => {
          if (!open) onOpenDns(null);
        }}
        onRefresh={onRefreshDns}
        onGenerateDkim={() => {
          if (dnsDomain) onGenerateDkim(dnsDomain);
        }}
      />
    </>
  );
}
