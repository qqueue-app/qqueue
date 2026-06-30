import { FormEvent, useEffect, useState } from "react";
import {
  AtSign,
  Copy,
  Globe,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  api,
  type SenderIdentity,
  type SendingDomain,
  type SendingDomainDnsRecords,
  type SMTPConnection
} from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Badge } from "../components/ui/badge.js";
import { Spinner } from "../components/ui/spinner.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Textarea } from "../components/ui/textarea.js";
import { Card, CardContent } from "../components/ui/card.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";

// The add-domain wizard's single branching question. "choose" presents it;
// "external" collects the domain for trust-upstream mode; "managed" explains
// that QQueue-side DKIM signing is not available yet.
type WizardStep = "choose" | "external" | "managed";

interface IdentityForm {
  sendingDomainId: string;
  fromName: string;
  fromEmail: string;
  smtpConnectionId: string;
  replyTo: string;
  isDefault: boolean;
}

const emptyIdentityForm: IdentityForm = {
  sendingDomainId: "",
  fromName: "",
  fromEmail: "",
  smtpConnectionId: "",
  replyTo: "",
  isDefault: false
};

export function SendingDomains() {
  const { currentOrganizationId: organizationId } = useSession();
  const [domains, setDomains] = useState<SendingDomain[]>([]);
  const [identities, setIdentities] = useState<SenderIdentity[]>([]);
  const [connections, setConnections] = useState<SMTPConnection[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-domain wizard state.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>("choose");
  const [domainName, setDomainName] = useState("");
  const [spfNote, setSpfNote] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteDomainTarget, setDeleteDomainTarget] =
    useState<SendingDomain | null>(null);
  const [deletingDomain, setDeletingDomain] = useState(false);

  // Sender-identity dialog state.
  const [identityOpen, setIdentityOpen] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState<SenderIdentity | null>(
    null
  );
  const [identityForm, setIdentityForm] =
    useState<IdentityForm>(emptyIdentityForm);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [deleteIdentityTarget, setDeleteIdentityTarget] =
    useState<SenderIdentity | null>(null);
  const [deletingIdentity, setDeletingIdentity] = useState(false);

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [domainList, identityList, connectionList] = await Promise.all([
        api.listSendingDomains(organizationId),
        api.listSenderIdentities(organizationId),
        api.listSMTPConnections(organizationId)
      ]);
      setDomains(domainList);
      setIdentities(identityList);
      setConnections(connectionList);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load sending domains"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  function openWizard() {
    setStep("choose");
    setDomainName("");
    setSpfNote("");
    setWizardOpen(true);
  }

  async function submitDomain(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }
    const managed = step === "managed";
    setSavingDomain(true);
    try {
      const created = await api.createSendingDomain({
        organizationId,
        domain: domainName,
        dkimMode: managed ? "MANAGED" : "EXTERNAL",
        spfNote: spfNote.trim() || undefined
      });
      toast.success(
        managed
          ? "Domain added. Publish the DNS records below, then verify."
          : "Sending domain added."
      );
      setWizardOpen(false);
      // Managed domains have DNS records to act on — expand the new card.
      if (managed) {
        setExpandedId(created.id);
      }
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add sending domain."
      );
    } finally {
      setSavingDomain(false);
    }
  }

  async function verifyDomain(domain: SendingDomain) {
    setVerifyingId(domain.id);
    try {
      await api.verifySendingDomain(domain.id);
      toast.success("Verification queued — checking DNS now.");
      // The worker updates status asynchronously; reload shortly after.
      window.setTimeout(() => {
        void load();
      }, 2500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify.");
    } finally {
      setVerifyingId(null);
    }
  }

  async function confirmDeleteDomain() {
    if (!deleteDomainTarget) return;
    setDeletingDomain(true);
    try {
      await api.deleteSendingDomain(deleteDomainTarget.id);
      toast.success("Sending domain deleted.");
      setDeleteDomainTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete.");
    } finally {
      setDeletingDomain(false);
    }
  }

  function openCreateIdentity(domain?: SendingDomain) {
    setEditingIdentity(null);
    setIdentityForm({
      ...emptyIdentityForm,
      sendingDomainId: domain?.id ?? domains[0]?.id ?? "",
      smtpConnectionId: connections.find((c) => c.isDefault)?.id ?? "",
      isDefault: identities.length === 0
    });
    setIdentityOpen(true);
  }

  function openEditIdentity(identity: SenderIdentity) {
    setEditingIdentity(identity);
    setIdentityForm({
      sendingDomainId: identity.sendingDomainId,
      fromName: identity.fromName,
      fromEmail: identity.fromEmail,
      smtpConnectionId: identity.smtpConnectionId,
      replyTo: identity.replyTo ?? "",
      isDefault: identity.isDefault
    });
    setIdentityOpen(true);
  }

  async function submitIdentity(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }
    setSavingIdentity(true);
    try {
      if (editingIdentity) {
        // From address and domain are immutable on an identity; only the
        // presentation/transport fields can change.
        await api.updateSenderIdentity(editingIdentity.id, {
          fromName: identityForm.fromName,
          smtpConnectionId: identityForm.smtpConnectionId,
          replyTo: identityForm.replyTo.trim() || null,
          isDefault: identityForm.isDefault
        });
        toast.success("Sender identity updated.");
      } else {
        await api.createSenderIdentity({
          organizationId,
          sendingDomainId: identityForm.sendingDomainId,
          fromName: identityForm.fromName,
          fromEmail: identityForm.fromEmail,
          smtpConnectionId: identityForm.smtpConnectionId,
          replyTo: identityForm.replyTo.trim() || undefined,
          isDefault: identityForm.isDefault
        });
        toast.success("Sender identity added.");
      }
      setIdentityOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save sender identity."
      );
    } finally {
      setSavingIdentity(false);
    }
  }

  async function confirmDeleteIdentity() {
    if (!deleteIdentityTarget) return;
    setDeletingIdentity(true);
    try {
      await api.deleteSenderIdentity(deleteIdentityTarget.id);
      toast.success("Sender identity deleted.");
      setDeleteIdentityTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete.");
    } finally {
      setDeletingIdentity(false);
    }
  }

  const domainsById = new Map(domains.map((d) => [d.id, d]));
  const connectionsById = new Map(connections.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader
        title="Sending Domains"
        description="Register the domains you send From, then add sender identities (like noreply@) backed by a sending account."
        actions={
          <Button onClick={openWizard} disabled={!organizationId}>
            <Plus className="h-4 w-4" />
            Add domain
          </Button>
        }
      />

      <section className="space-y-6 p-6">
        {/* Sending domains */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Domains
          </h2>
          {loading ? (
            [0, 1].map((index) => (
              <Card key={index}>
                <CardContent className="p-5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-2 h-4 w-64" />
                </CardContent>
              </Card>
            ))
          ) : domains.length === 0 ? (
            <Card>
              <EmptyState
                icon={Globe}
                title="No sending domains yet"
                description="Add a domain to start sending as addresses like noreply@ without a real mailbox."
                action={
                  <Button
                    onClick={openWizard}
                    disabled={!organizationId}
                    variant="outline"
                  >
                    <Plus className="h-4 w-4" />
                    Add domain
                  </Button>
                }
              />
            </Card>
          ) : (
            domains.map((domain) => (
              <Card key={domain.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{domain.domain}</h3>
                        <DkimBadge domain={domain} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {domain.dkimMode === "EXTERNAL"
                          ? "DKIM signed upstream by your mail server or relay."
                          : "DKIM signed by QQueue."}
                        {domain.spfNote ? ` · ${domain.spfNote}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {domain.dkimMode === "MANAGED" ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setExpandedId(
                                expandedId === domain.id ? null : domain.id
                              )
                            }
                          >
                            {expandedId === domain.id ? "Hide DNS" : "DNS records"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => verifyDomain(domain)}
                            disabled={verifyingId === domain.id}
                          >
                            {verifyingId === domain.id ? (
                              <Spinner />
                            ) : (
                              <ShieldCheck className="h-4 w-4" />
                            )}
                            Verify now
                          </Button>
                        </>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => openCreateIdentity(domain)}
                        aria-label="Add sender identity"
                      >
                        <AtSign className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteDomainTarget(domain)}
                        aria-label="Delete domain"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {domain.dkimMode === "MANAGED" &&
                  expandedId === domain.id &&
                  domain.dnsRecords ? (
                    <DnsRecordsPanel records={domain.dnsRecords} />
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Sender identities */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Sender identities
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openCreateIdentity()}
              disabled={!organizationId || domains.length === 0}
            >
              <Plus className="h-4 w-4" />
              New identity
            </Button>
          </div>
          {loading ? (
            <Card>
              <CardContent className="p-5">
                <Skeleton className="h-5 w-48" />
              </CardContent>
            </Card>
          ) : identities.length === 0 ? (
            <Card>
              <EmptyState
                icon={AtSign}
                title="No sender identities yet"
                description={
                  domains.length === 0
                    ? "Add a sending domain first, then create an identity under it."
                    : "Add an identity like noreply@ and bind it to a sending account."
                }
              />
            </Card>
          ) : (
            identities.map((identity) => {
              const domain = domainsById.get(identity.sendingDomainId);
              const connection = connectionsById.get(identity.smtpConnectionId);
              return (
                <Card key={identity.id}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">
                          {identity.fromName} &lt;{identity.fromEmail}&gt;
                        </h3>
                        {identity.isDefault ? <Badge>Default</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {domain ? `${domain.domain} · ` : ""}
                        via {connection?.name ?? "unknown account"}
                        {identity.replyTo
                          ? ` · reply-to ${identity.replyTo}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditIdentity(identity)}
                        aria-label="Edit identity"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteIdentityTarget(identity)}
                        aria-label="Delete identity"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </section>

      {/* Add-domain wizard */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add sending domain</DialogTitle>
            <DialogDescription>
              {step === "choose"
                ? "Does your mail server or relay already sign DKIM for this domain?"
                : step === "external"
                  ? "QQueue will trust your upstream server or relay to sign DKIM."
                  : "QQueue-managed DKIM signing is coming soon."}
            </DialogDescription>
          </DialogHeader>

          {step === "choose" ? (
            <div className="space-y-3">
              <button
                type="button"
                className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setStep("external")}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4 text-success" />
                  Yes — my server or relay signs DKIM
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Recommended for Mailcow, SES, Mailgun, Postmark, or any relay.
                  QQueue signs nothing and trusts your upstream setup.
                </p>
              </button>
              <button
                type="button"
                className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setStep("managed")}
              >
                <div className="font-semibold">
                  No — nothing signs DKIM upstream
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  For a bare SMTP server (raw Postfix/Exim). QQueue would generate
                  keys and sign mail itself.
                </p>
              </button>
            </div>
          ) : null}

          {step === "external" || step === "managed" ? (
            <form onSubmit={submitDomain} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  placeholder="acme.com"
                  value={domainName}
                  onChange={(e) => setDomainName(e.target.value)}
                  required
                />
              </div>
              {step === "managed" ? (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  QQueue will generate an RSA-2048 DKIM keypair and show you the
                  DNS records to publish. After you add them at your DNS host,
                  click <span className="font-medium">Verify now</span> on the
                  domain to confirm.
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="spfNote">Reminder (optional)</Label>
                  <Textarea
                    id="spfNote"
                    rows={2}
                    placeholder="e.g. noreply@ alias and SPF configured in Mailcow"
                    value={spfNote}
                    onChange={(e) => setSpfNote(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Make sure addresses like noreply@ are configured as an alias
                    or in your relay&apos;s allowed send-as list. QQueue does not
                    enforce this — it&apos;s a note for your team.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("choose")}
                >
                  Back
                </Button>
                <Button type="submit" disabled={savingDomain}>
                  {savingDomain ? <Spinner /> : null}
                  {step === "managed" ? "Generate keys & add" : "Add domain"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Add / edit sender identity */}
      <Dialog open={identityOpen} onOpenChange={setIdentityOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingIdentity ? "Edit sender identity" : "New sender identity"}
            </DialogTitle>
            <DialogDescription>
              The From address must be on the chosen sending domain.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitIdentity} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identity-domain">Sending domain</Label>
              <Select
                value={identityForm.sendingDomainId}
                onValueChange={(value) =>
                  setIdentityForm({ ...identityForm, sendingDomainId: value })
                }
                disabled={Boolean(editingIdentity)}
              >
                <SelectTrigger id="identity-domain">
                  <SelectValue placeholder="Select a domain" />
                </SelectTrigger>
                <SelectContent>
                  {domains.map((domain) => (
                    <SelectItem key={domain.id} value={domain.id}>
                      {domain.domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="identity-name">From name</Label>
                <Input
                  id="identity-name"
                  placeholder="Acme Support"
                  value={identityForm.fromName}
                  onChange={(e) =>
                    setIdentityForm({ ...identityForm, fromName: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="identity-email">From email</Label>
                <Input
                  id="identity-email"
                  type="email"
                  placeholder="noreply@acme.com"
                  value={identityForm.fromEmail}
                  onChange={(e) =>
                    setIdentityForm({
                      ...identityForm,
                      fromEmail: e.target.value
                    })
                  }
                  disabled={Boolean(editingIdentity)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="identity-smtp">Sending account</Label>
              <Select
                value={identityForm.smtpConnectionId}
                onValueChange={(value) =>
                  setIdentityForm({ ...identityForm, smtpConnectionId: value })
                }
              >
                <SelectTrigger id="identity-smtp">
                  <SelectValue placeholder="Select a sending account" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {connections.length === 0 ? (
                <p className="text-xs text-warning">
                  Add a sending account first — an identity needs one to send
                  through.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="identity-replyto">Reply-to (optional)</Label>
              <Input
                id="identity-replyto"
                type="email"
                placeholder="support@acme.com"
                value={identityForm.replyTo}
                onChange={(e) =>
                  setIdentityForm({ ...identityForm, replyTo: e.target.value })
                }
              />
            </div>
            <label
              htmlFor="identity-default"
              className="flex items-center gap-2.5 text-sm font-medium"
            >
              <Checkbox
                id="identity-default"
                checked={identityForm.isDefault}
                onCheckedChange={(checked) =>
                  setIdentityForm({ ...identityForm, isDefault: checked })
                }
              />
              Use as default sender identity
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIdentityOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  savingIdentity ||
                  !identityForm.sendingDomainId ||
                  !identityForm.smtpConnectionId
                }
              >
                {savingIdentity ? <Spinner /> : null}
                {editingIdentity ? "Save" : "Add identity"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteDomainTarget !== null}
        onOpenChange={(open) => !open && setDeleteDomainTarget(null)}
        title="Delete sending domain?"
        description={`"${deleteDomainTarget?.domain}" and all of its sender identities will be permanently removed.`}
        confirmLabel="Delete"
        loading={deletingDomain}
        onConfirm={confirmDeleteDomain}
      />

      <ConfirmDialog
        open={deleteIdentityTarget !== null}
        onOpenChange={(open) => !open && setDeleteIdentityTarget(null)}
        title="Delete sender identity?"
        description={`"${deleteIdentityTarget?.fromEmail}" will be permanently removed.`}
        confirmLabel="Delete"
        loading={deletingIdentity}
        onConfirm={confirmDeleteIdentity}
      />
    </>
  );
}

function DnsRecordsPanel({
  records
}: {
  records: SendingDomainDnsRecords;
}) {
  const rows = [
    { label: "DKIM (required)", record: records.dkim },
    { label: "SPF (replace YOUR_SERVER_IP)", record: records.spf },
    { label: "DMARC (recommended)", record: records.dmarc }
  ];

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <p className="text-xs text-muted-foreground">
        Add these TXT records at your DNS host, then click Verify now. DNS
        changes can take a while to propagate.
      </p>
      {rows.map(({ label, record }) => (
        <div key={record.host} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">{record.type}</span>
          </div>
          <div className="rounded-md border bg-background p-2">
            <code className="block break-all text-xs text-muted-foreground">
              {record.host}
            </code>
          </div>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 rounded-md border bg-background p-2">
              <code className="block break-all text-xs">{record.value}</code>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => copy(record.value)}
              aria-label={`Copy ${label} value`}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DkimBadge({ domain }: { domain: SendingDomain }) {
  if (domain.dkimMode === "EXTERNAL") {
    return <Badge variant="secondary">External DKIM</Badge>;
  }
  const variant =
    domain.dkimStatus === "VERIFIED"
      ? "success"
      : domain.dkimStatus === "FAILED"
        ? "destructive"
        : "warning";
  return <Badge variant={variant}>Managed · {domain.dkimStatus}</Badge>;
}
