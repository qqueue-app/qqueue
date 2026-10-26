import { BodyEditor } from "../../components/editor/BodyEditor.js";
import {
  BRANDING_STARTERS,
  brandingLayoutError,
  createBrandingLayout,
  renderBrandingLayout,
  type BrandingStarter
} from "@qqueue/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../../components/ui/alert-dialog.js";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, Info, Trash2 } from "lucide-react";
import { PageContainer } from "../../components/PageContainer.js";
import { PageHeader } from "../../components/PageHeader.js";
import {
  Field,
  FormSection,
  FormSections
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
import {
  errorMessage,
  useApiMutation,
  useOrgQuery
} from "../../lib/use-api.js";

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
  brandingEnabled: true
};

/** Form state keeps strings; the API takes nulls. Empty means "add nothing". */
interface BrandingForm {
  brandName: string;
  logoUrl: string;
  accentColor: string;
  footerNote: string;
  brandingEnabled: boolean;
  layoutHtml: string | null;
}

function toForm(branding: OrganizationBranding): BrandingForm {
  return {
    brandName: branding.brandName ?? "",
    logoUrl: branding.logoUrl ?? "",
    accentColor: branding.accentColor ?? "",
    footerNote: branding.footerNote ?? "",
    brandingEnabled: branding.brandingEnabled,
    layoutHtml: branding.layoutHtml ?? null
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
    layoutHtml: form.layoutHtml
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const PREVIEW_CONTENT =
  '<h1 style="font-size:24px;line-height:1.3;">Spring release is live</h1><p>Hi Dana, we shipped three things you asked for.</p><p><a href="https://example.com">See what’s new</a></p>';

export function BrandingSettings() {
  const { currentOrganizationId, currentOrganization } = useSession();
  const canEdit =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";

  const [form, setForm] = useState<BrandingForm>(toForm(EMPTY));
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const seededOrganization = useRef<string | null>(null);
  const activeOrganization = useRef(currentOrganizationId);
  activeOrganization.current = currentOrganizationId;
  const [pendingStarter, setPendingStarter] = useState<
    BrandingStarter | "original" | null
  >(null);

  const branding = useOrgQuery(
    currentOrganizationId,
    qk.organizationBranding(currentOrganizationId ?? ""),
    (organizationId) => api.getOrganizationBranding(organizationId)
  );

  // Refetches must not overwrite a design the user is editing.
  useEffect(() => {
    if (
      branding.data &&
      currentOrganizationId &&
      seededOrganization.current !== currentOrganizationId
    ) {
      setForm(toForm(branding.data));
      seededOrganization.current = currentOrganizationId;
      setPendingStarter(null);
    }
  }, [branding.data, currentOrganizationId]);

  const save = useApiMutation(
    ({
      organizationId,
      payload
    }: {
      organizationId: string;
      payload: OrganizationBranding;
    }) => api.updateOrganizationBranding(organizationId, payload),
    {
      successMessage: "Branding saved.",
      errorMessage: "Unable to save branding",
      invalidates: ({ organizationId }) => [
        qk.organizationBranding(organizationId)
      ]
    }
  );

  async function uploadLogo(file: File) {
    if (!currentOrganizationId) return;
    const organizationId = currentOrganizationId;
    setUploading(true);
    try {
      // Through the image pipeline, not attachments: the returned URL is public
      // and absolute because a recipient's mail client has no session.
      const image = await api.uploadImage(file, {
        organizationId
      });
      if (activeOrganization.current === organizationId) {
        setForm((previous) => ({ ...previous, logoUrl: image.url }));
      }
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
    if (layoutError || accentInvalid || branding.isError || !canEdit) return;
    save.mutate({
      organizationId: currentOrganizationId,
      payload: toPayload(form)
    });
  }

  const accent = HEX.test(form.accentColor.trim())
    ? form.accentColor.trim()
    : DEFAULT_ACCENT;
  const accentInvalid =
    form.accentColor.trim() !== "" && !HEX.test(form.accentColor.trim());

  const layoutSource = form.layoutHtml ?? createBrandingLayout(form);
  const visualLayout = renderBrandingLayout(layoutSource, "{{content}}", form);
  const layoutError =
    form.layoutHtml === null ? null : brandingLayoutError(form.layoutHtml);
  const previewBody = form.brandingEnabled
    ? renderBrandingLayout(layoutSource, PREVIEW_CONTENT, form)
    : renderBrandingLayout(
        '<html><body style="padding:24px;font-family:Arial,sans-serif;">{{content}}<p>{{footer_note}}</p></body></html>',
        PREVIEW_CONTENT,
        form
      );
  const previewFooter =
    '<p style="text-align:center;font:12px Arial;color:#9aa5b1;">Unsubscribe</p>';
  const previewHtml = /<\/body\s*>/i.test(previewBody)
    ? previewBody.replace(/<\/body\s*>/i, (close) => `${previewFooter}${close}`)
    : `${previewBody}${previewFooter}`;

  function applyStarter(starter: BrandingStarter | "original") {
    setForm((previous) => ({
      ...previous,
      layoutHtml:
        starter === "original" ? null : createBrandingLayout(previous, starter)
    }));
  }

  function chooseStarter(starter: BrandingStarter | "original") {
    if (form.layoutHtml !== null) setPendingStarter(starter);
    else applyStarter(starter);
  }

  return (
    <>
      <PageHeader
        title="Branding"
        description="Edit your email branding visually, with your logo, colours, and reusable designs."
        breadcrumb={{ label: "Settings", to: "/settings" }}
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm(toForm(branding.data ?? EMPTY))}
                disabled={
                  save.isPending || branding.isLoading || branding.isError
                }
              >
                Discard
              </Button>
              <Button
                type="submit"
                form="branding-form"
                disabled={
                  save.isPending ||
                  branding.isLoading ||
                  branding.isError ||
                  uploading ||
                  Boolean(layoutError) ||
                  accentInvalid
                }
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
        ) : branding.isError ? (
          <div role="alert" className="space-y-3">
            <p>Your saved branding could not be loaded.</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void branding.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_28rem] xl:items-start">
            <form id="branding-form" onSubmit={submit}>
              <fieldset disabled={!canEdit} className="min-w-0 border-0 p-0">
                <FormSections>
                  <FormSection
                    title="Apply branding"
                    description="Whether QQueue frames your email content with this saved design."
                  >
                    <SettingsRow
                      label="Brand outgoing emails"
                      htmlFor="brandingEnabled"
                      description="When enabled, the saved design wraps the message body. Tracking and bulk unsubscribe footers are added separately."
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
                    title="Email layout"
                    description="Edit text, add images and links, and change formatting directly. Start with your saved branding or choose a design. Changes apply when you save."
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      {BRANDING_STARTERS.map((starter) => {
                        const thumbnail = renderBrandingLayout(
                          createBrandingLayout(form, starter.id),
                          PREVIEW_CONTENT,
                          form
                        );
                        return (
                          <div
                            key={starter.id}
                            className="space-y-2 rounded-control border p-3"
                          >
                            <div className="pointer-events-none h-40 overflow-hidden rounded-control border bg-email-paper">
                              <iframe
                                key={thumbnail}
                                title={`${starter.name} design preview`}
                                sandbox=""
                                srcDoc={thumbnail}
                                tabIndex={-1}
                                aria-hidden="true"
                                className="h-[480px] w-[300%] origin-top-left scale-[0.333333] border-0"
                              />
                            </div>
                            <p className="text-ui font-medium">
                              {starter.name}
                            </p>
                            <p className="text-meta text-muted-foreground">
                              {starter.description}
                            </p>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => chooseStarter(starter.id)}
                            >
                              Use {starter.name.toLowerCase()}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      <Label>Email branding</Label>
                      <BodyEditor
                        value={visualLayout}
                        ariaLabel="Email branding"
                        allowSource={false}
                        disabled={!canEdit}
                        showVariables={false}
                        onChange={(html) =>
                          setForm((previous) => ({
                            ...previous,
                            layoutHtml: html
                          }))
                        }
                        onUploadImage={async (file) => {
                          const organizationId = currentOrganizationId;
                          if (!organizationId)
                            throw new Error("Select an organization first.");
                          const image = await api.uploadImage(file, {
                            organizationId
                          });
                          if (activeOrganization.current !== organizationId)
                            throw new Error(
                              "The organization changed. Reopen the editor to add this image."
                            );
                          return image.url;
                        }}
                      />
                      <FieldHint>
                        The sample message appears where {"{{content}}"} is.
                        Keep that marker to preview your design around the body.
                      </FieldHint>
                      {layoutError ? (
                        <p role="alert" className="text-meta text-destructive">
                          {layoutError}
                        </p>
                      ) : null}
                    </div>
                    <details className="rounded-control border p-3">
                      <summary className="cursor-pointer text-ui font-medium">
                        Advanced: HTML source
                      </summary>
                      <Field className="mt-3">
                        <Label htmlFor="brandingHtml">Branding HTML</Label>
                        <Textarea
                          id="brandingHtml"
                          rows={12}
                          spellCheck={false}
                          className="font-mono text-xs"
                          aria-invalid={Boolean(layoutError)}
                          value={layoutSource}
                          onChange={(event) =>
                            setForm((previous) => ({
                              ...previous,
                              layoutHtml: event.target.value
                            }))
                          }
                        />
                        <FieldHint>
                          Optional placeholders:{" "}
                          {
                            "{{brand_name}}, {{logo_url}}, {{accent_color}}, {{footer_note}}"
                          }
                          . These use the saved identity fields. Keep{" "}
                          {"{{content}}"} exactly once.
                        </FieldHint>
                      </Field>
                    </details>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => chooseStarter("original")}
                      disabled={form.layoutHtml === null}
                    >
                      Use original layout
                    </Button>
                  </FormSection>
                  <FormSection
                    title="Saved identity"
                    description="Used to fill starter designs and HTML placeholders. In a customized design, edit its text and images directly in the editor above."
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
                              accentColor: event.target.value
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
                        placeholder={
                          "Acme Inc\n400 Market St, Springfield IL 62704"
                        }
                        onChange={(event) =>
                          setForm({ ...form, footerNote: event.target.value })
                        }
                      />
                      <FieldHint>
                        Required by anti-spam law in most regions for bulk mail.
                      </FieldHint>
                    </Field>

                    <div className="flex items-start gap-2 rounded-control border border-border bg-accent px-3 py-2.5">
                      <Info
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      />
                      <p className="text-ui text-text-secondary">
                        <span className="font-semibold text-text">
                          Campaign unsubscribe links are on by default.
                        </span>{" "}
                        You can turn the automatic link off in each campaign. To
                        place it yourself instead, put{" "}
                        <code className="rounded-control bg-surface-sunken px-1 py-0.5">
                          {"{{unsubscribe_url}}"}
                        </code>{" "}
                        in a campaign template and the automatic one steps
                        aside.
                      </p>
                    </div>
                  </FormSection>
                </FormSections>
              </fieldset>
            </form>

            <aside className="xl:sticky xl:top-4">
              <p className="mb-2 text-eyebrow font-semibold uppercase tracking-wide text-text-tertiary">
                Live preview
              </p>
              <iframe
                key={previewHtml}
                title="Branding preview"
                sandbox=""
                srcDoc={previewHtml}
                className="h-[36rem] w-full rounded-card border bg-email-paper"
              />
              <p className="mt-2 text-meta text-text-tertiary">
                        This saved design is applied to outgoing email bodies.
              </p>
            </aside>
          </div>
        )}
      </PageContainer>
      <AlertDialog
        open={pendingStarter !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStarter(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this branding design?</AlertDialogTitle>
            <AlertDialogDescription>
              Your logo, colours, brand name, and address will be kept. This
              replaces the design you are editing. Nothing changes for sent
              emails until you save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingStarter) applyStarter(pendingStarter);
                setPendingStarter(null);
              }}
            >
              Replace layout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
