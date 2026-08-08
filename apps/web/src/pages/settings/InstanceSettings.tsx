import { PageContainer } from "../../components/PageContainer.js";
import type { ReactNode } from "react";
import { ServerCog } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import {
  FormSection,
  FormSections,
} from "../../components/settings/FormLayout.js";
import { Badge } from "../../components/ui/badge.js";
import { Spinner } from "../../components/ui/spinner.js";
import { SettingsRow, Switch } from "../../components/ui/switch.js";
import { api, type InstanceEnvStatus } from "../../lib/api.js";
import { formatBytes } from "../../lib/format.js";
import { qk } from "../../lib/query-client.js";
import { useApiMutation } from "../../lib/use-api.js";
import { useInstanceAdmin } from "../../lib/use-instance-admin.js";
import { invalidateSetupStatus } from "../../lib/setup-status.js";

/**
 * Server-wide settings, for instance administrators.
 *
 * Instance admin is not org OWNER — a person can own every organization on a
 * server and still not administer the server. The Settings hub hides the row
 * entirely for everyone else; this page still has to answer for itself, because
 * a URL can be typed.
 */
export function InstanceSettings() {
  const { isInstanceAdmin, settings, isPending } = useInstanceAdmin();

  const envStatusQuery = useQuery<InstanceEnvStatus>({
    queryKey: qk.instanceEnvStatus(),
    queryFn: () => api.instanceEnvStatus(),
    enabled: isInstanceAdmin === true,
  });

  const setRegistration = useApiMutation(
    (allowPublicRegistration: boolean) =>
      api.updateInstanceSettings({ allowPublicRegistration }),
    {
      successMessage: (updated) =>
        updated.allowPublicRegistration
          ? "Registration is now open to visitors."
          : "Registration is now invite only.",
      errorMessage: "Unable to update setting",
      invalidates: [qk.instanceSettings()],
      onSuccess: () => {
        // The login screen decides whether to offer "create an account" from
        // this; a stale copy would advertise a door that is now locked.
        invalidateSetupStatus();
      },
    }
  );

  const header = (
    <PageHeader
      title="Instance"
      description="Server-wide settings and configuration health."
      breadcrumb={{ label: "Settings", to: "/settings" }}
    />
  );

  // Nothing at all until the probe settles: flashing "administrators only" at
  // an administrator for a frame is worse than showing nothing for one.
  if (isPending) {
    return (
      <>
        {header}
        <PageContainer>
          <div className="flex items-center gap-2 text-ui text-text-secondary">
            <Spinner />
            Checking access
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
            icon={ServerCog}
            title="Instance administrators only"
            description="These settings belong to whoever runs this server. Being an owner of an organization is a different thing."
          />
        </PageContainer>
      </>
    );
  }

  const envStatus = envStatusQuery.data;

  return (
    <>
      {header}

      <PageContainer>
        <FormSections>
          <FormSection
            title="Access"
            description="Who may create an account on this server."
          >
            <div className="border-t border-border">
              <SettingsRow
                label="Allow public registration"
                description="When off, visitors can't self-register at /register. You can still add people to any organization from its Team page — invitations work even while this is off."
                htmlFor="allow-registration"
              >
                {settings ? (
                  <Switch
                    id="allow-registration"
                    checked={settings.allowPublicRegistration}
                    disabled={setRegistration.isPending}
                    onCheckedChange={(checked) =>
                      setRegistration.mutate(checked === true)
                    }
                    aria-label="Allow public registration"
                  />
                ) : (
                  <Spinner />
                )}
              </SettingsRow>
            </div>
          </FormSection>

          <FormSection
            title="Configuration health"
            description="A read-only view of how this server is configured. Change these in its .env file."
          >
            {envStatus ? (
              <dl className="border-t border-border">
                <HealthRow label="Database">
                  <Badge variant={envStatus.database.ok ? "ok" : "err"}>
                    {envStatus.database.ok ? "Connected" : "Unreachable"}
                  </Badge>
                </HealthRow>
                <HealthRow label="Redis (queue)">
                  <Badge variant={envStatus.redis.ok ? "ok" : "err"}>
                    {envStatus.redis.ok ? "Connected" : "Unreachable"}
                  </Badge>
                </HealthRow>
                <HealthRow label="File storage">
                  <span className="font-mono text-meta text-text-secondary">
                    {envStatus.storage.bucket}
                  </span>
                </HealthRow>
                <HealthRow label="Inbound webhook secret">
                  <Badge
                    variant={
                      envStatus.secrets.webhookSecretConfigured
                        ? "ok"
                        : "neutral"
                    }
                  >
                    {envStatus.secrets.webhookSecretConfigured
                      ? "Configured"
                      : "Not set"}
                  </Badge>
                </HealthRow>
                <HealthRow label="Tracking link base">
                  <span className="break-all font-mono text-meta text-text-secondary">
                    {envStatus.urls.appUrl}
                  </span>
                </HealthRow>
                <HealthRow label="Attachment size limit">
                  <span data-numeric className="text-ui text-text-secondary">
                    {formatBytes(envStatus.tunables.attachmentMaxBytes)}
                  </span>
                </HealthRow>
              </dl>
            ) : (
              <div className="flex items-center gap-2 text-ui text-text-secondary">
                <Spinner />
                Checking configuration
              </div>
            )}
          </FormSection>
        </FormSections>
      </PageContainer>
    </>
  );
}

/**
 * One configuration fact. A definition list rather than the grid of bordered
 * tiles this used to be — six boxes with one word in each is a lot of border
 * for very little information.
 */
function HealthRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3">
      <dt className="text-ui text-text">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
