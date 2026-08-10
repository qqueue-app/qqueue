import { FormEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, Lock, Trash2 } from "lucide-react";
import { PageContainer } from "../../components/PageContainer.js";
import { PageHeader } from "../../components/PageHeader.js";
import {
  Field,
  FormSection,
  FormSections,
} from "../../components/settings/FormLayout.js";
import { Button } from "../../components/ui/button.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Input } from "../../components/ui/input.js";
import { FieldHint, Label } from "../../components/ui/label.js";
import { Spinner } from "../../components/ui/spinner.js";
import { SettingsRow, Switch } from "../../components/ui/switch.js";
import { Textarea } from "../../components/ui/textarea.js";
import { api, type OrganizationBranding } from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useSession } from "../../lib/session-context.js";
import { errorMessage, useApiMutation, useOrgQuery } from "../../lib/use-api.js";

/**
 * How this organization's mail looks to the people who receive it.
 *
 * Its own destination rather than a panel on /settings/organization, because
 * the hub gates by destination: this is OWNER/ADMIN-only and that page is not.
 * The preview is the reason it earns a page — a colour field with no picture of
 * the email it changes is a guess.
 */

/** The engine's own DEFAULT_ACCENT, not the app's brand green. */
const DEFAULT_ACCENT = "#2E7D63";

const EMPTY: OrganizationBranding = {
  brandName: null,
  logoUrl: null,
  accentColor: null,
  footerNote: null,
  brandingEnabled: true,
};

/** Form state keeps strings; the API takes nulls. Empty means "add nothing". */
interface BrandingForm {
  brandName: string;
  logoUrl: string;
  accentColor: string;
  footerNote: string;
  brandingEnabled: boolean;
}

function toForm(branding: OrganizationBranding): BrandingForm {
  return {
    brandName: branding.brandName ?? "",
    logoUrl: branding.logoUrl ?? "",
    accentColor: branding.accentColor ?? "",
    footerNote: branding.footerNote ?? "",
    brandingEnabled: branding.brandingEnabled,
  };
}

function toPayload(form: BrandingForm): OrganizationBranding {
  const trim = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    brandName: trim(form.brandName),
    logoUrl: trim(form.logoUrl),
    accentColor: trim(form.accentColor),
    footerNote: trim(form.footerNote),
    brandingEnabled: form.brandingEnabled,
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function BrandingSettings() {
  const { currentOrganizationId, currentOrganization } = useSession();
  const canEdit =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";

  const [form, setForm] = useState<BrandingForm>(toForm(EMPTY));
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const branding = useOrgQuery(
    currentOrganizationId,
    qk.organizationBranding(currentOrganizationId ?? ""),
    (organizationId) => api.getOrganizationBranding(organizationId)
  );

  // Seed the form once the server value lands. Keyed on the fetched object so
  // switching organizations reseeds instead of stranding the previous org's
  // values in the inputs.
  useEffect(() => {
    if (branding.data) {
      setForm(toForm(branding.data));
    }
  }, [branding.data]);

  const save = useApiMutation(
    (payload: OrganizationBranding) =>
      api.updateOrganizationBranding(currentOrganizationId!, payload),
    {
      successMessage: "Branding saved.",
      errorMessage: "Unable to save branding",
      invalidates: [qk.organizationBranding(currentOrganizationId ?? "")],
    }
  );

  async function uploadLogo(file: File) {
    if (!currentOrganizationId) return;
    setUploading(true);
    try {
      // Through the image pipeline, not attachments: the returned URL is public
      // and absolute because a recipient's mail client has no session.
      const image = await api.uploadImage(file, {
        organizationId: currentOrganizationId,
      });
      setForm((previous) => ({ ...previous, logoUrl: image.url }));
    } catch (error) {
      const { toast } = await import("sonner");
      toast.error(errorMessage(error, "Unable to upload the logo"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!currentOrganizationId) return;
    save.mutate(toPayload(form));
  }

  const accent = HEX.test(form.accentColor.trim())
    ? form.accentColor.trim()
    : DEFAULT_ACCENT;
  const accentInvalid =
    form.accentColor.trim() !== "" && !HEX.test(form.accentColor.trim());

  return (
    <>
      <PageHeader
        title="Branding"
        description="Your logo, colours, and the footer on every campaign."
        breadcrumb={{ label: "Settings", to: "/settings" }}
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm(toForm(branding.data ?? EMPTY))}
                disabled={save.isPending || branding.isLoading}
              >
                Discard
              </Button>
              <Button
                type="submit"
                form="branding-form"
                disabled={save.isPending || branding.isLoading}
              >
                {save.isPending ? <Spinner className="mr-2" /> : null}
                Save changes
              </Button>
            </div>
          ) : null
        }
      />

      <PageContainer>
        {branding.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <form id="branding-form" onSubmit={submit}>
              <fieldset disabled={!canEdit} className="min-w-0 border-0 p-0">
                <FormSections>
                  <FormSection
                    title="Apply branding"
                    description="Whether QQueue frames your content with the styling below."
                  >
                    <SettingsRow
                      label="Brand outgoing emails"
                      htmlFor="brandingEnabled"
                      description="Off sends each template's HTML exactly as you wrote it, with no header, colours, or layout added. Your address and the unsubscribe link are still included — those are required on bulk mail."
                    >
                      <Switch
                        id="brandingEnabled"
                        checked={form.brandingEnabled}
                        disabled={!canEdit}
                        onCheckedChange={(checked) =>
                          setForm({ ...form, brandingEnabled: checked })
                        }
                      />
                    </SettingsRow>
                  </FormSection>

                  <FormSection
                    title="Identity"
                    description="Shown at the top of your emails. Leave both empty and no header is added — nothing is ever stamped on your mail that you didn't choose."
                  >
                    <Field>
                      <Label htmlFor="brandName">Brand name</Label>
                      <Input
                        id="brandName"
                        value={form.brandName}
                        maxLength={100}
                        placeholder="Acme"
                        onChange={(event) =>
                          setForm({ ...form, brandName: event.target.value })
                        }
                      />
                      <FieldHint>
                        Also used for the copyright line in the footer.
                      </FieldHint>
                    </Field>

                    <Field>
                      <Label htmlFor="logo">Logo</Label>
                      <div className="flex flex-wrap items-center gap-3">
                        {form.logoUrl ? (
                          <img
                            src={form.logoUrl}
                            alt=""
                            className="h-12 w-12 rounded-control border border-border bg-surface object-contain p-1"
                          />
                        ) : null}
                        <input
                          ref={fileInput}
                          id="logo"
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void uploadLogo(file);
                          }}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => fileInput.current?.click()}
                          disabled={uploading}
                        >
                          {uploading ? (
                            <Spinner className="mr-2" />
                          ) : (
                            <ImagePlus className="mr-2 h-4 w-4" />
                          )}
                          {form.logoUrl ? "Replace" : "Upload"}
                        </Button>
                        {form.logoUrl ? (
                          <IconButton
                            label="Remove logo"
                            type="button"
                            onClick={() => setForm({ ...form, logoUrl: "" })}
                          >
                            <Trash2 />
                          </IconButton>
                        ) : null}
                      </div>
                      <FieldHint>
                        PNG, JPEG, GIF, or WebP. Replaces the brand name in the
                        header. SVG isn't accepted — it can carry script, and
                        this image is served from a public URL.
                      </FieldHint>
                    </Field>

                    <Field>
                      <Label htmlFor="accentColor">Accent colour</Label>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-9 w-9 shrink-0 rounded-control border border-border-strong"
                          style={{ backgroundColor: accent }}
                        />
                        <Input
                          id="accentColor"
                          value={form.accentColor}
                          placeholder={DEFAULT_ACCENT}
                          aria-invalid={accentInvalid}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              accentColor: event.target.value,
                            })
                          }
                        />
                      </div>
                      <FieldHint>
                        {accentInvalid
                          ? "Use a six-digit hex colour, e.g. #2E7D63."
                          : `Links and the wordmark inside the email. Defaults to ${DEFAULT_ACCENT}.`}
                      </FieldHint>
                    </Field>
                  </FormSection>

                  <FormSection
                    title="Footer"
                    description="Appears under every campaign and recurring send."
                  >
                    <Field>
                      <Label htmlFor="footerNote">Address</Label>
                      <Textarea
                        id="footerNote"
                        rows={3}
                        maxLength={500}
                        value={form.footerNote}
                        placeholder={"Acme Inc\n400 Market St, Springfield IL 62704"}
                        onChange={(event) =>
                          setForm({ ...form, footerNote: event.target.value })
                        }
                      />
                      <FieldHint>
                        Required by anti-spam law in most regions for bulk mail.
                      </FieldHint>
                    </Field>

                    <div className="flex items-start gap-2 rounded-control border border-border bg-accent px-3 py-2.5">
                      <Lock
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      />
                      <p className="text-ui text-text-secondary">
                        <span className="font-semibold text-text">
                          An unsubscribe link is always added.
                        </span>{" "}
                        It can't be turned off for bulk mail. To place it
                        yourself instead, put{" "}
                        <code className="rounded-control bg-surface-sunken px-1 py-0.5">
                          {"{{unsubscribe_url}}"}
                        </code>{" "}
                        in a campaign template and the automatic one steps aside.
                      </p>
                    </div>
                  </FormSection>
                </FormSections>
              </fieldset>
            </form>

            <aside className="lg:sticky lg:top-4">
              <p className="mb-2 text-eyebrow font-semibold uppercase tracking-wide text-text-tertiary">
                Preview
              </p>
              {/*
                --email-paper, not --surface: this stands for what a mail client
                paints behind the message, so it must not follow the app if the
                app ever gets a dark palette. A preview that goes dark is lying
                about the email.
              */}
              <div className="rounded-card border border-border bg-email-paper p-5 shadow-card">
                {/* Header, accent, and copyright are the frame — the switch
                    governs all three. The address and unsubscribe link below
                    are obligations, so they stay either way. */}
                {form.brandingEnabled ? (
                  form.logoUrl ? (
                    <img
                      src={form.logoUrl}
                      alt=""
                      className="mx-auto max-h-10 object-contain"
                    />
                  ) : form.brandName.trim() ? (
                    <p
                      className="text-center text-title font-semibold tracking-tight"
                      style={{ color: accent }}
                    >
                      {form.brandName}
                    </p>
                  ) : null
                ) : null}

                <div className="mt-4 text-body text-[#1f2933]">
                  <p className="mb-2 text-section font-semibold text-[#102a43]">
                    Spring release is live
                  </p>
                  <p className="mb-2">
                    Hi Dana, we shipped three things you asked for.
                  </p>
                  <p>
                    <span
                      style={
                        form.brandingEnabled ? { color: accent } : undefined
                      }
                    >
                      See what&rsquo;s new
                    </span>
                  </p>
                </div>

                <div className="mt-5 border-t border-[#eef2f6] pt-3 text-center text-meta text-[#9aa5b1]">
                  {form.brandingEnabled && form.brandName.trim() ? (
                    <span className="block">&copy; {form.brandName}</span>
                  ) : null}
                  {form.footerNote.trim() ? (
                    <span className="block whitespace-pre-line">
                      {form.footerNote}
                    </span>
                  ) : null}
                  <span className="mt-2 block underline">Unsubscribe</span>
                </div>
              </div>
              <p className="mt-2 text-meta text-text-tertiary">
                {form.brandingEnabled
                  ? "Applied to campaigns, recurring sends, and anything you compose."
                  : "Templates send exactly as authored. Only the address and unsubscribe link are added."}
              </p>
            </aside>
          </div>
        )}
      </PageContainer>
    </>
  );
}
