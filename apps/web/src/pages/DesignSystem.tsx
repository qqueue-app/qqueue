import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Info,
  Mail,
  Pencil,
  Trash2,
  XCircle
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Avatar } from "../components/ui/avatar.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../components/ui/card.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { EmptyState } from "../components/EmptyState.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Input } from "../components/ui/input.js";
import {
  Eyebrow,
  FieldError,
  FieldHint,
  Label
} from "../components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";
import { SettingsRow, Switch } from "../components/ui/switch.js";
import { Textarea } from "../components/ui/textarea.js";

/**
 * The design-system reference page.
 *
 * Every base component rendered against the real tokens, so the foundation can
 * be judged on its own before any page is restyled. Not linked from navigation
 * and not part of the product — it lives at /design-system for review.
 */

function Section({
  title,
  note,
  children
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border pt-8 first:border-0 first:pt-0">
      <h2 className="text-section font-semibold text-text">{title}</h2>
      {note ? (
        <p className="mt-1 max-w-[45rem] text-ui leading-6 text-text-secondary">
          {note}
        </p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`h-9 w-9 shrink-0 rounded-control border border-border ${className}`}
      />
      <code className="text-meta text-text-secondary">{name}</code>
    </div>
  );
}

export function DesignSystem() {
  const [notify, setNotify] = useState(true);
  const [digest, setDigest] = useState(false);
  const [checked, setChecked] = useState(true);

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[52rem] px-6 py-12">
        <header className="mb-12">
          <Eyebrow>Foundation</Eyebrow>
          <h1 className="mt-2 text-title font-semibold text-text">
            Design system
          </h1>
          <p className="mt-1 text-ui leading-6 text-text-secondary">
            Every base component against the real tokens. Nothing here sets a
            colour, radius, or size of its own.
          </p>
        </header>

        <div className="flex flex-col gap-12">
          <Section
            title="Colour"
            note="Warm gray neutrals, one demoted brand green, and four status pairs of tinted background plus dark text."
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Eyebrow>Surfaces</Eyebrow>
                <Swatch name="--bg" className="bg-bg" />
                <Swatch name="--surface" className="bg-surface" />
                <Swatch name="--surface-sunken" className="bg-surface-sunken" />
                <Swatch name="--border" className="bg-border" />
                <Swatch name="--border-strong" className="bg-border-strong" />
              </div>
              <div className="flex flex-col gap-3">
                <Eyebrow>Brand &amp; status</Eyebrow>
                <Swatch name="--accent" className="bg-primary" />
                <Swatch name="--accent-soft" className="bg-accent" />
                <Swatch name="--ok-bg" className="bg-ok-bg" />
                <Swatch name="--warn-bg" className="bg-warn-bg" />
                <Swatch name="--err-bg" className="bg-err-bg" />
              </div>
            </div>
          </Section>

          <Section
            title="Type"
            note="Inter, six sizes, nothing bolder than 600. Numbers are tabular everywhere they line up."
          >
            <div className="flex flex-col gap-4">
              <div className="text-stat font-semibold text-text" data-numeric>
                1,284,096
                <span className="ml-3 text-meta font-medium text-text-tertiary">
                  28px stat · tabular
                </span>
              </div>
              <p className="text-title font-semibold text-text">
                Page title — 20px/600
              </p>
              <p className="text-section font-semibold text-text">
                Section title — 16px/600
              </p>
              <p className="text-body text-text">
                Body — 14px. The default for everything you actually read.
              </p>
              <p className="text-ui text-text-secondary">
                Secondary — 13px. Descriptions and table cells.
              </p>
              <p className="text-meta text-text-tertiary">
                Meta — 12px. Timestamps and helper text.
              </p>
              <div className="rounded-card border border-border bg-surface p-4">
                <p className="text-meta text-text-tertiary">
                  Tabular vs. proportional — the reason it matters
                </p>
                <div className="mt-2 grid grid-cols-2 gap-6 text-ui">
                  <div>
                    <div className="text-meta text-text-tertiary">tabular</div>
                    <div className="tabular-nums text-text">
                      <div>1,111.11</div>
                      <div>8,888.88</div>
                      <div>4,096.40</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-meta text-text-tertiary">
                      proportional
                    </div>
                    <div className="text-text">
                      <div>1,111.11</div>
                      <div>8,888.88</div>
                      <div>4,096.40</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Buttons"
            note="One primary per view. Height 36px, radius 6px, labels that name the outcome."
          >
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Send email</Button>
                <Button variant="secondary">Save draft</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="destructive">
                  <Trash2 />
                  Delete
                </Button>
                <Button variant="link">Learn more</Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button size="sm" variant="secondary">
                  Small secondary
                </Button>
                <Button disabled>Disabled</Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <IconButton label="Reply">
                  <Mail />
                </IconButton>
                <IconButton label="Edit" variant="outline">
                  <Pencil />
                </IconButton>
                <IconButton label="Send" variant="solid">
                  <Mail />
                </IconButton>
                <IconButton label="Delete" variant="destructive">
                  <Trash2 />
                </IconButton>
                <span className="text-meta text-text-tertiary">
                  36px visual, 44px touch target below 640px
                </span>
              </div>
            </div>
          </Section>

          <Section
            title="Inputs"
            note="Width comes from the content type, never the container. Whitespace to the right of a field is correct. On a phone every one of these goes full width, and their text is 16px so iOS does not zoom."
          >
            <div className="flex flex-col gap-5">
              <div>
                <Label htmlFor="demo-email">Email address</Label>
                <Input
                  id="demo-email"
                  type="email"
                  width="name"
                  className="mt-1.5"
                  placeholder="person@example.com"
                />
                <FieldHint className="mt-1.5">
                  360px — sized for an address, not for the page.
                </FieldHint>
              </div>

              <div>
                <Label htmlFor="demo-subject">Subject line</Label>
                <Input
                  id="demo-subject"
                  width="long"
                  className="mt-1.5"
                  placeholder="Your receipt from Acme"
                />
                <FieldHint className="mt-1.5">480px</FieldHint>
              </div>

              <div>
                <Label htmlFor="demo-port">SMTP port</Label>
                <Input
                  id="demo-port"
                  width="code"
                  inputMode="numeric"
                  className="mt-1.5"
                  defaultValue="587"
                />
                <FieldHint className="mt-1.5">
                  120px — the audit&apos;s worst case, previously ~1100px.
                </FieldHint>
              </div>

              <div>
                <Label htmlFor="demo-invalid">Invalid state</Label>
                <Input
                  id="demo-invalid"
                  width="name"
                  className="mt-1.5"
                  aria-invalid
                  aria-describedby="demo-invalid-error"
                  defaultValue="not-an-address"
                />
                <FieldError id="demo-invalid-error" className="mt-1.5">
                  Enter a valid email address.
                </FieldError>
              </div>

              <div>
                <Label htmlFor="demo-select">Sending account</Label>
                <Select defaultValue="support">
                  <SelectTrigger
                    id="demo-select"
                    width="name"
                    className="mt-1.5"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="support">support@qqueue.dev</SelectItem>
                    <SelectItem value="billing">billing@qqueue.dev</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="demo-body">Message</Label>
                <Textarea
                  id="demo-body"
                  className="mt-1.5"
                  rows={4}
                  placeholder="A textarea is the one control that does fill the column — prose has no natural width."
                />
              </div>
            </div>
          </Section>

          <Section
            title="Badges"
            note="Tinted background with dark text. Never a solid saturated pill."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">Draft</Badge>
              <Badge variant="accent">Selected</Badge>
              <Badge variant="ok">Delivered</Badge>
              <Badge variant="warn">Deferred</Badge>
              <Badge variant="err">Bounced</Badge>
              <Badge variant="info">Queued</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
          </Section>

          <Section
            title="Cards"
            note="A surface on the page background, separated by a hairline rather than a shadow. Cards never nest."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Sending health</CardTitle>
                  <CardDescription>
                    Bounce rate across the last 30 days.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-stat font-semibold text-text" data-numeric>
                    0.42%
                  </div>
                  <p className="mt-1 text-meta text-text-tertiary">
                    12,480 delivered · 52 bounced
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Failed jobs</CardTitle>
                  <CardDescription>
                    An alarming value colours the number, not an icon.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-stat font-semibold text-err" data-numeric>
                    17
                  </div>
                  <p className="mt-1 text-meta text-text-tertiary">
                    Needs attention
                  </p>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Section
            title="Toggles and settings rows"
            note="Label and description left, control right, hairline between. This replaces grids of bordered toggle boxes."
          >
            <Card>
              <CardContent className="pt-6">
                <SettingsRow
                  label="Email notifications"
                  description="Send a push when a new reply lands in the inbox."
                  htmlFor="demo-notify"
                >
                  <Switch
                    id="demo-notify"
                    checked={notify}
                    onCheckedChange={setNotify}
                    aria-label="Email notifications"
                  />
                </SettingsRow>
                <SettingsRow
                  label="Daily digest"
                  description="One summary at 09:00 instead of individual alerts."
                  htmlFor="demo-digest"
                >
                  <Switch
                    id="demo-digest"
                    checked={digest}
                    onCheckedChange={setDigest}
                    aria-label="Daily digest"
                  />
                </SettingsRow>
                <SettingsRow label="Include bounce details">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={setChecked}
                    aria-label="Include bounce details"
                  />
                </SettingsRow>
              </CardContent>
            </Card>
          </Section>

          <Section
            title="Alerts"
            note="The same status pairs as badges, at message scale."
          >
            <div className="flex flex-col gap-3">
              <Alert variant="info">
                <Info />
                <AlertTitle>Scheduled maintenance</AlertTitle>
                <AlertDescription>
                  Sending pauses for ten minutes at 02:00 UTC.
                </AlertDescription>
              </Alert>
              <Alert variant="success">
                <CheckCircle2 />
                <AlertTitle>Connection verified</AlertTitle>
                <AlertDescription>
                  smtp.example.com accepted the test message.
                </AlertDescription>
              </Alert>
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>Bounce rate climbing</AlertTitle>
                <AlertDescription>
                  4.1% over the last hour, up from 0.4%.
                </AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <XCircle />
                <AlertTitle>Cannot reach the API</AlertTitle>
                <AlertDescription>
                  Make sure the QQueue API is running, then reload this page.
                </AlertDescription>
              </Alert>
            </div>
          </Section>

          <Section
            title="Focus"
            note="One treatment everywhere: a 2px accent outline, offset 2px. Tab through this row — outline follows each shape's own radius and never gets clipped."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary">Button</Button>
              <Input width="code" defaultValue="Input" aria-label="Focus demo input" />
              <IconButton label="Icon button">
                <Inbox />
              </IconButton>
              <Switch
                checked={notify}
                onCheckedChange={setNotify}
                aria-label="Toggle"
              />
              <Checkbox
                checked={checked}
                onCheckedChange={setChecked}
                aria-label="Checkbox"
              />
            </div>
          </Section>

          <Section
            title="Avatars"
            note="Four identity tints at the neutrals' lightness, so a list reads as texture rather than confetti. They carry no status meaning."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name="Ada Lovelace" />
              <Avatar name="Grace Hopper" />
              <Avatar name="Alan Turing" />
              <Avatar name="Katherine Johnson" />
              <Avatar name="support@qqueue.dev" size="sm" />
              <Avatar name="Ada Lovelace" size="lg" />
            </div>
          </Section>

          <Section
            title="Empty state"
            note="Compact and useful, not a monument. No bordered box, no icon tile adrift in it, and a secondary button — an empty list is not the place for the loudest control on the page."
          >
            <Card>
              <EmptyState
                icon={Inbox}
                title="No drafts yet"
                description="Anything you start writing and don't send will wait for you here."
                action={<Button variant="secondary">Compose an email</Button>}
              />
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
