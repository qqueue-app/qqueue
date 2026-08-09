import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "../../components/PageContainer.js";
import { PageHeader } from "../../components/PageHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Spinner } from "../../components/ui/spinner.js";
import {
  MailDomainsPanel,
  type MailDomainFormValues,
} from "../../components/settings/MailDomainsPanel.js";
import {
  api,
  type InstanceMailDomainSummary,
  type InstanceOrganizationSummary,
  type MailDomainDnsStatus,
} from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useApiMutation } from "../../lib/use-api.js";
import { useInstanceAdmin } from "../../lib/use-instance-admin.js";

/**
 * Domains — the mail server every organization on this instance shares.
 *
 * This page exists because org OWNER was the wrong permission for it. Creating
 * or deleting a Mailcow domain changes the server for everyone, and claiming
 * one decided which org could reach it — but `POST /organizations` is ungated,
 * so any user could create an org, own it, and from there manage the shared
 * mail server. Domain management is install scope, so it lives behind
 * `isInstanceAdmin`.
 *
 * The Settings hub hides the row for everyone else; this page still answers for
 * itself, because a URL can be typed.
 */

/**
 * Domain form values -> API payload.
 *
 * A blank numeric field is *omitted*, never sent as 0: Mailcow reads 0 as
 * "unlimited", so posting a zero for a box left empty would silently strip the
 * server's own limits.
 */
function domainPayload(values: MailDomainFormValues) {
  const maxMailboxes = values.maxMailboxes.trim();
  const defaultQuota = values.defaultQuotaMiB.trim();
  return {
    description: values.description.trim(),
    active: values.active,
    ...(maxMailboxes === "" ? {} : { maxMailboxes: Number(maxMailboxes) }),
    ...(defaultQuota === "" ? {} : { defaultQuotaMiB: Number(defaultQuota) }),
  };
}

export function InstanceDomains() {
  const { isInstanceAdmin, isPending } = useInstanceAdmin();
  const queryClient = useQueryClient();
  /** The domain whose DNS drawer is open, if any. */
  const [dnsDomain, setDnsDomain] = useState<string | null>(null);

  const enabled = isInstanceAdmin === true;

  const domainsQuery = useQuery<InstanceMailDomainSummary[]>({
    queryKey: qk.instanceMailDomains(),
    queryFn: () => api.listInstanceMailDomains(),
    enabled,
  });

  // The assignment menu needs the org list; it is small and cached alongside.
  const organizationsQuery = useQuery<InstanceOrganizationSummary[]>({
    queryKey: qk.instanceOrganizations(),
    queryFn: () => api.listInstanceOrganizations(),
    enabled,
  });

  // Fetched only while the drawer is open. Each entry costs a handful of live
  // DNS lookups, so prefetching every domain's records would make opening the
  // page far more expensive than reading it.
  const dnsQuery = useQuery<MailDomainDnsStatus>({
    queryKey: qk.instanceMailDomainDns(dnsDomain ?? ""),
    queryFn: () => api.getInstanceMailDomainDns(dnsDomain as string),
    enabled: enabled && dnsDomain !== null,
  });

  // Mutes are read here so unmuting knows which row to delete without a
  // second round trip.
  const mutesQuery = useQuery({
    queryKey: qk.instanceMutes(),
    queryFn: () => api.listInstanceMutes(),
    enabled,
  });

  const domainKeys = [qk.instanceMailDomains()];

  const createDomain = useApiMutation(
    (values: MailDomainFormValues) =>
      api.createInstanceMailDomain({
        ...domainPayload(values),
        domain: values.domain.trim().toLowerCase(),
      }),
    {
      errorMessage: "Couldn't add that domain.",
      invalidates: domainKeys,
      onSuccess: (result) => {
        // Straight into the DNS drawer: a domain that exists but has no records
        // published is not yet a working domain, and this is the one moment the
        // administrator is guaranteed to be paying attention.
        setDnsDomain(result.domain.domain);
        toast.success(
          `${result.domain.domain} added. Publish its DNS records to finish.`
        );
      },
    }
  );

  const updateDomain = useApiMutation(
    (input: { domain: string; values: MailDomainFormValues }) =>
      api.updateInstanceMailDomain(input.domain, domainPayload(input.values)),
    {
      successMessage: "Domain updated.",
      errorMessage: "Couldn't update that domain.",
      invalidates: domainKeys,
    }
  );

  const assignDomain = useApiMutation(
    (input: { domain: string; organizationId: string | null }) =>
      api.assignInstanceMailDomain(input.domain, input.organizationId),
    {
      successMessage: (_result, input) =>
        input.organizationId
          ? "Domain assigned. That organization can now provision mailboxes on it."
          : "Domain unassigned. It now reaches no organization.",
      errorMessage: "Couldn't change that assignment.",
      // Reassigning drops the losing org's grants, and the org list shows a
      // domain count, so both go stale.
      invalidates: [
        ...domainKeys,
        qk.instanceOrganizations(),
        qk.instanceMailDomainGrants(),
      ],
    }
  );

  const toggleMute = useApiMutation(
    async (domain: InstanceMailDomainSummary) => {
      if (!domain.muted) {
        await api.addInstanceMute({ scope: "DOMAIN", target: domain.domain });
        return;
      }
      const existing = (mutesQuery.data ?? []).find(
        (mute) =>
          mute.scope === "DOMAIN" &&
          mute.target === domain.domain.toLowerCase()
      );
      if (existing) {
        await api.removeInstanceMute(existing.id);
      }
    },
    {
      successMessage: (_result, domain) =>
        domain.muted
          ? `${domain.domain} is back in your lists.`
          : `${domain.domain} hidden from your lists. Access is unchanged.`,
      errorMessage: "Couldn't update your view.",
      invalidates: [...domainKeys, qk.instanceMutes(), qk.instanceMailboxes()],
    }
  );

  const deleteDomain = useApiMutation(
    (input: { domain: string; confirm: string }) =>
      api.deleteInstanceMailDomain(input.domain, { confirm: input.confirm }),
    {
      successMessage: "Domain deleted.",
      errorMessage: "Couldn't delete that domain.",
      // Deleting a domain removes the sending accounts under it across every
      // org, so the instance mailbox list and the org list both go stale.
      invalidates: [
        ...domainKeys,
        qk.instanceMailboxes(),
        qk.instanceOrganizations(),
      ],
    }
  );

  const generateDkim = useApiMutation(
    (domain: string) => api.generateInstanceMailDomainDkim(domain),
    {
      successMessage: "DKIM key generated. Publish the new record.",
      errorMessage: "Couldn't generate a DKIM key.",
      invalidates: domainKeys,
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: qk.instanceMailDomainDns(dnsDomain ?? ""),
        });
      },
    }
  );

  const header = (
    <PageHeader
      title="Domains"
      description="The mail server every organization on this instance shares."
      breadcrumb={{ label: "Settings", to: "/settings" }}
    />
  );

  if (isPending) {
    return (
      <>
        {header}
        <PageContainer>
          <div className="flex items-center gap-2 text-body text-muted-foreground">
            <Spinner />
            Checking access…
          </div>
        </PageContainer>
      </>
    );
  }

  if (!isInstanceAdmin) {
    return (
      <>
        {header}
        <PageContainer>
          <EmptyState
            icon={Globe}
            title="Instance administrators only"
            description="Mail domains are shared by every organization on this server, so only an instance administrator can manage them. Ask yours to assign a domain to your organization."
          />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      {header}
      <PageContainer>
        <MailDomainsPanel
          domains={domainsQuery.data ?? []}
          loading={domainsQuery.isPending}
          organizations={organizationsQuery.data ?? []}
          dnsDomain={dnsDomain}
          dns={dnsQuery.data}
          dnsLoading={dnsQuery.isPending}
          pending={{
            save: createDomain.isPending || updateDomain.isPending,
            delete: deleteDomain.isPending,
            dkim: generateDkim.isPending,
          }}
          onOpenDns={setDnsDomain}
          onRefreshDns={() =>
            void queryClient.invalidateQueries({
              queryKey: qk.instanceMailDomainDns(dnsDomain ?? ""),
            })
          }
          onGenerateDkim={(domain) => generateDkim.mutate(domain)}
          onCreate={(values) => createDomain.mutate(values)}
          onUpdate={(domain, values) => updateDomain.mutate({ domain, values })}
          onAssign={(domain, organizationId) =>
            assignDomain.mutate({ domain: domain.domain, organizationId })
          }
          onToggleMute={(domain) => toggleMute.mutate(domain)}
          onDelete={(domain, confirm) =>
            deleteDomain.mutate({ domain, confirm })
          }
        />
      </PageContainer>
    </>
  );
}
