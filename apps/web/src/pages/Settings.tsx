import { FormEvent, useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Separator } from "../components/ui/separator.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../components/ui/card.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";

const apiBaseUrl =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

export function Settings() {
  const {
    user,
    organizations,
    currentOrganizationId,
    setCurrentOrganizationId,
    addOrganization,
    signOut: clearSessionState
  } = useSession();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const organization = await api.createOrganization({ name });
      // Creator is always the OWNER; make the new org active immediately.
      addOrganization(
        { id: organization.id, name: organization.name, role: "OWNER" },
        true
      );
      setName("");
      toast.success(`Organization "${organization.name}" created.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create organization"
      );
    } finally {
      setSaving(false);
    }
  }

  function selectOrganization(organizationId: string) {
    setCurrentOrganizationId(organizationId);
    const selected = organizations.find((org) => org.id === organizationId);
    toast.success(`Switched to ${selected?.name ?? "organization"}.`);
  }

  function signOut() {
    clearSessionState();
    window.location.href = "/login";
  }

  return (
    <>
      <PageHeader title="Settings" description="Organization and developer settings." />
      <section className="grid gap-6 p-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createOrganization} className="space-y-4">
              <div className="space-y-2">
                <Label>Active organization</Label>
                <Select
                  value={currentOrganizationId ?? undefined}
                  onValueChange={selectOrganization}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((organization) => (
                      <SelectItem key={organization.id} value={organization.id}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="new-org">New organization</Label>
                <Input
                  id="new-org"
                  placeholder="Acme Inc."
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? <Spinner /> : null}
                {saving ? "Creating…" : "Create organization"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="font-medium">Email</dt>
                <dd className="mt-1 text-muted-foreground">
                  {user?.email ?? "Not signed in"}
                </dd>
              </div>
              <div>
                <dt className="font-medium">API base URL</dt>
                <dd className="mt-1 font-mono text-xs text-muted-foreground">
                  {apiBaseUrl}
                </dd>
              </div>
            </dl>
            <Separator className="my-5" />
            <Button type="button" variant="outline" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
