import type { TemplateVariable } from "@/lib/api";

// Built-in starter templates for the "New template" gallery. Mirrors the
// server-side STARTER_TEMPLATES in @qqueue/shared; kept local so the web app
// stays free of the shared package (and its Zod bundle).
export interface StarterTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  subject: string;
  html: string;
  variables: TemplateVariable[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "blank",
    name: "Blank",
    description: "Start from an empty canvas.",
    category: "Basic",
    subject: "",
    html: "<p></p>",
    variables: []
  },
  {
    key: "welcome",
    name: "Welcome",
    description: "Greet a new user and point them to a first action.",
    category: "Onboarding",
    subject: "Welcome to {{company}}, {{firstName}}!",
    html: [
      "<h1>Welcome aboard, {{firstName}} 👋</h1>",
      "<p>We're thrilled to have you at {{company}}. Your account is ready to go.</p>",
      "<p>To get the most out of it, start by setting up your first project.</p>",
      '<a data-qq-button="true" href="{{ctaUrl}}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#2e7d63;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Get started</a>',
      "<p>If you have any questions, just reply to this email — we're here to help.</p>",
      "<p>— The {{company}} team</p>"
    ].join("\n"),
    variables: [
      { name: "firstName", label: "First name", defaultValue: "there" },
      { name: "company", label: "Company", defaultValue: "QQueue" },
      {
        name: "ctaUrl",
        label: "Call-to-action URL",
        defaultValue: "https://example.com/start"
      }
    ]
  },
  {
    key: "newsletter",
    name: "Newsletter",
    description: "A simple update with a heading, body, and sign-off.",
    category: "Newsletter",
    subject: "{{company}} news — {{month}}",
    html: [
      "<h1>What's new at {{company}}</h1>",
      "<p>Hi {{firstName}}, here's the latest from us this month.</p>",
      "<h2>Highlight of the month</h2>",
      "<p>Share your most important update here. Keep it short and skimmable.</p>",
      '<p><a href="{{ctaUrl}}">Read more</a></p>',
      "<hr />",
      "<p>Thanks for reading,<br />The {{company}} team</p>"
    ].join("\n"),
    variables: [
      { name: "firstName", label: "First name", defaultValue: "there" },
      { name: "company", label: "Company", defaultValue: "QQueue" },
      { name: "month", label: "Month", defaultValue: "this month" },
      {
        name: "ctaUrl",
        label: "Call-to-action URL",
        defaultValue: "https://example.com"
      }
    ]
  },
  {
    key: "password-reset",
    name: "Password reset",
    description: "Transactional reset link with a clear call to action.",
    category: "Transactional",
    subject: "Reset your {{company}} password",
    html: [
      "<h1>Reset your password</h1>",
      "<p>Hi {{firstName}}, we received a request to reset your password.</p>",
      '<a data-qq-button="true" href="{{resetUrl}}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#2e7d63;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Choose a new password</a>',
      "<p>This link expires in 30 minutes. If you didn't request a reset, you can safely ignore this email.</p>",
      "<p>— The {{company}} team</p>"
    ].join("\n"),
    variables: [
      { name: "firstName", label: "First name", defaultValue: "there" },
      { name: "company", label: "Company", defaultValue: "QQueue" },
      {
        name: "resetUrl",
        label: "Reset URL",
        defaultValue: "https://example.com/reset",
        required: true
      }
    ]
  },
  {
    key: "announcement",
    name: "Announcement",
    description: "Launch or feature announcement with a prominent button.",
    category: "Marketing",
    subject: "Introducing {{feature}}",
    html: [
      "<h1>Say hello to {{feature}}</h1>",
      "<p>Hi {{firstName}}, we just shipped something we think you'll love.</p>",
      "<p>Describe what's new and why it matters in a sentence or two.</p>",
      '<a data-qq-button="true" href="{{ctaUrl}}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#2e7d63;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Try it now</a>',
      "<p>— The {{company}} team</p>"
    ].join("\n"),
    variables: [
      { name: "firstName", label: "First name", defaultValue: "there" },
      { name: "company", label: "Company", defaultValue: "QQueue" },
      {
        name: "feature",
        label: "Feature name",
        defaultValue: "our new feature"
      },
      {
        name: "ctaUrl",
        label: "Call-to-action URL",
        defaultValue: "https://example.com"
      }
    ]
  }
];
