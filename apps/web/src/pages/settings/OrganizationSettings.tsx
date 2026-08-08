import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "../../components/PageHeader.js";
import {
  Field,
  FormColumn,
  FormSection,
  FormSections,
} from "../../components/settings/FormColumn.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { FieldHint, Label } from "../../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Spinner } from "../../components/ui/spinner.js";
import { api } from "../../lib/api.js";
import { useSession } from "../../lib/session-context.js";

/**
 * The organization itself: which one you are working in, renaming it, and
 * creating another.
 *
 * User-scoped settings deliberately are not here — signing out and per-device
 * notifications live at /settings/account. Mixing the two scopes on one page is
 * what made the old settings screen ambiguous about what "Save" applied to.
 */
export function OrganizationSettings() {
  const {
    organizations,
    currentOrganizationId,
    setCurrentOrganizationId,
    addOrganization,
  } = useSession();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const activeOrganization = organizations.find(
    (org) => org.id === currentOrganizationId
  );

  function selectOrganization(organizationId: string) {
    setCurrentOrganizationId(organizationId);
    const selected = organizations.find((org) => org.id === organizationId);
    toast.success(`Switched to ${selected?.name ?? "organization"}.`);
  }

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

  async function renameOrganization(event: FormEvent) {
    event.preventDefault();
    if (!currentOrganizationId || !renameValue.trim()) {
      return;
    }
    setRenaming(true);
    try {
      const organization = await api.updateOrganization(currentOrganizationId, {
        name: renameValue.trim(),
      });
      const existingRole =
        organizations.find((org) => org.id === organization.id)?.role ?? "OWNER";
      addOrganization(
        { id: organization.id, name: organization.name, role: existingRole },
        false
      );
      setRenameValue("");
      toast.success(`Organization renamed to "${organization.name}".`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to rename organization"
      );
    } finally {
      setRenaming(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Organization"
        description="The workspace everything else on this page is scoped to."
        breadcrumb={{ label: "Settings", to: "/settings" }}
      />

      <FormColumn>
        <FormSections>
          <FormSection
            title="Active organization"
            description="Contacts, campaigns, and sending accounts all belong to one organization. This is the one you are looking at."
          >
            <Field>
              <Label htmlFor="active-org">Organization</Label>
              <Select
                value={currentOrganizationId ?? undefined}
                onValueChange={selectOrganization}
              >
                <SelectTrigger id="active-org" width="name">
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
            </Field>
          </FormSection>

          <FormSection
            title="Rename"
            description="Changes the name everywhere it appears, including on invitations already sent."
          >
            {/*
              The one place the anti-stretch rule needs saying out loud: the
              field is 360px because an organization name is, and the button
              sits beside it rather than under it because they are one action.
              Below 480px both go full width and stack.
            */}
            <form
              onSubmit={renameOrganization}
              className="flex flex-col gap-3 xs:flex-row xs:items-end"
            >
              <Field>
                <Label htmlFor="rename-org">Organization name</Label>
                <Input
                  id="rename-org"
                  width="name"
                  placeholder={activeOrganization?.name ?? "Organization name"}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="secondary"
                disabled={
                  renaming || !currentOrganizationId || !renameValue.trim()
                }
              >
                {renaming ? <Spinner /> : null}
                Rename
              </Button>
            </form>
          </FormSection>

          <FormSection
            title="New organization"
            description="A separate workspace with its own contacts, sending accounts, and team. You become its owner."
          >
            <form onSubmit={createOrganization} className="space-y-4">
              <Field>
                <Label htmlFor="new-org">Name</Label>
                <Input
                  id="new-org"
                  width="name"
                  placeholder="Acme Inc."
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <FieldHint>
                  You can switch between organizations at any time.
                </FieldHint>
              </Field>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? <Spinner /> : null}
                {saving ? "Creating..." : "Create organization"}
              </Button>
            </form>
          </FormSection>
        </FormSections>
      </FormColumn>
    </>
  );
}
