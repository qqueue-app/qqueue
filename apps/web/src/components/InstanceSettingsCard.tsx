import { useEffect, useState } from "react";
import { ServerCog } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  api,
  type InstanceEnvStatus,
  type InstanceSettings,
} from "../lib/api.js";
import { invalidateSetupStatus } from "../lib/setup-status.js";
import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Label } from "./ui/label.js";
import { Separator } from "./ui/separator.js";
import { Spinner } from "./ui/spinner.js";
import { Switch } from "./ui/switch.js";

function formatBytes(bytes: number) {
  if (bytes >= 1_048_576) {
    return `${Math.round(bytes / 1_048_576)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Instance-wide server settings, visible only to instance admins (the API
 * returns 403 for everyone else, in which case this renders nothing).
 */
export function InstanceSettingsCard() {
  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [envStatus, setEnvStatus] = useState<InstanceEnvStatus | null>(null);
  const [hidden, setHidden] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getInstanceSettings()
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setHidden(false);
        return api.instanceEnvStatus().then((status) => {
          if (!cancelled) {
            setEnvStatus(status);
          }
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          // Not an instance admin — the card simply doesn't exist for them.
          return;
        }
        setHidden(false);
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to load instance settings"
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleRegistration(checked: boolean) {
    setUpdating(true);
    try {
      const updated = await api.updateInstanceSettings({
        allowPublicRegistration: checked,
      });
      setSettings(updated);
      invalidateSetupStatus();
      toast.success(
        updated.allowPublicRegistration
          ? "Registration is now open to visitors."
          : "Registration is now invite only."
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update setting"
      );
    } finally {
      setUpdating(false);
    }
  }

  if (hidden) {
    return null;
  }

  return (
    <Card className="h-fit lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ServerCog className="h-4 w-4" />
          Instance
        </CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          Server-wide settings and configuration health. Only instance
          administrators see this section.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/60 px-4 py-3">
          <div>
            <Label htmlFor="allow-registration" className="font-medium">
              Allow public registration
            </Label>
            <p className="mt-0.5 text-sm text-muted-foreground">
              When off, this server is invite only: visitors can't create
              accounts at /register.
            </p>
          </div>
          {settings ? (
            <Switch
              id="allow-registration"
              checked={settings.allowPublicRegistration}
              disabled={updating}
              onCheckedChange={(checked) =>
                void toggleRegistration(checked === true)
              }
              aria-label="Allow public registration"
            />
          ) : (
            <Spinner />
          )}
        </div>

        <Separator />

        <div>
          <h3 className="text-sm font-medium">Configuration health</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Read-only view of how this server is configured (from its
            environment). Change these in the server's .env file.
          </p>
          {envStatus ? (
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <dt>Database</dt>
                <dd>
                  <Badge variant={envStatus.database.ok ? "success" : "destructive"}>
                    {envStatus.database.ok ? "Connected" : "Unreachable"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <dt>Redis (queue)</dt>
                <dd>
                  <Badge variant={envStatus.redis.ok ? "success" : "destructive"}>
                    {envStatus.redis.ok ? "Connected" : "Unreachable"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <dt>File storage</dt>
                <dd className="truncate font-mono text-xs text-muted-foreground">
                  {envStatus.storage.bucket}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <dt>Inbound webhook secret</dt>
                <dd>
                  <Badge
                    variant={
                      envStatus.secrets.webhookSecretConfigured
                        ? "success"
                        : "secondary"
                    }
                  >
                    {envStatus.secrets.webhookSecretConfigured
                      ? "Configured"
                      : "Not set"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <dt>Tracking link base</dt>
                <dd className="truncate font-mono text-xs text-muted-foreground">
                  {envStatus.urls.appUrl}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <dt>Attachment size limit</dt>
                <dd className="text-muted-foreground">
                  {formatBytes(envStatus.tunables.attachmentMaxBytes)}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Checking configuration
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
