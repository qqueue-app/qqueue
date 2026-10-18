// Development-only visual fixture. No request can reach a real mailbox.
if (!import.meta.env.DEV)
  throw new Error("The mail preview is development only.");
import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "../lib/session-context.js";
import { saveSession } from "../lib/session.js";
import { api } from "../lib/api.js";
import { createQueryClient } from "../lib/query-client.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { AppRoutes } from "../routes/AppRoutes.js";
import "../styles.css";
const account = {
  id: "mailbox",
  organizationId: "demo",
  name: "Team",
  email: "hello@qqueue.test",
  fromEmail: "hello@qqueue.test",
  fromName: "QQueue Team",
  host: "imap.example.test",
  port: 993,
  secure: true,
  mailbox: "INBOX",
  status: "ACTIVE",
  isDefault: true,
  historyBeforeUid: 0,
  lastSyncedAt: new Date().toISOString(),
};
const samples = [
  [
    "Amara Owusu",
    "Brand direction for the autumn launch",
    "The revised concepts are ready for your review. I think the new direction feels much closer to what we discussed.",
    false,
  ],
  [
    "GitHub",
    "Your weekly development summary",
    "Here's what happened in your repositories this week. 12 pull requests merged and 4 releases published.",
    false,
  ],
  [
    "Daniel Mensah",
    "Re: Thursday's product walkthrough",
    "Thursday at 10 works for me. I'll bring the updated onboarding flow so we can walk through it together.",
    true,
  ],
  [
    "Notion",
    "Your workspace, a little more organized",
    "A few small updates to help your team get more done this week.",
    true,
  ],
  [
    "Sofia Chen",
    "Invoice for September",
    "Hi team, attaching the invoice for the work completed last month. Thank you as always!",
    false,
  ],
  [
    "Linear",
    "The details make the difference",
    "A collection of improvements that make your everyday work a little smoother.",
    true,
  ],
  [
    "Kwame Boateng",
    "Coffee next week?",
    "Are you around on Tuesday afternoon? It would be great to catch up and talk about the project.",
    true,
  ],
  [
    "The QQueue Team",
    "Welcome to your new inbox",
    "Your mail, your infrastructure. Everything you need to read, write, and manage email in one place.",
    true,
  ],
  [
    "Figma",
    "Your design review is ready",
    "Amara shared the updated brand exploration with you. Open the file to leave your feedback.",
    true,
  ],
  [
    "Grace Asante",
    "Notes from our planning session",
    "I've pulled together the decisions and next steps from this morning. Let me know if I missed anything.",
    true,
  ],
  [
    "Vercel",
    "Your deployment is ready",
    "The latest version of your project has been successfully deployed.",
    true,
  ],
  [
    "Maya Patel",
    "Re: Partnership proposal",
    "Thanks for sending this through. We'd love to explore a collaboration. Let's find a time to talk.",
    true,
  ],
  [
    "Open Source Weekly",
    "Good things are being built",
    "This week's projects, tools, and ideas from the open source community.",
    true,
  ],
  [
    "Alex Morgan",
    "October roadmap",
    "Sharing the updated milestones ahead of our team check-in tomorrow.",
    true,
  ],
  [
    "Nana",
    "A calmer place for your email",
    "This is the kind of space where your team can focus on the conversations that matter.",
    true,
  ],
];
const messages = samples.map(([name, subject, text, read], i) => ({
  id: `m${i}`,
  organizationId: "demo",
  inboxAccountId: "mailbox",
  messageId: `<${i}@example.test>`,
  references: [],
  fromEmail: `person${i}@example.test`,
  fromName: name,
  to: ["hello@qqueue.test"],
  cc: [],
  subject,
  text,
  html: null,
  receivedAt: new Date(Date.now() - i * 7800000).toISOString(),
  readAt: read ? new Date().toISOString() : null,
  flagged: i === 2,
  attachments: [],
  locations: [
    {
      id: `l${i}`,
      inboxFolderId: "inbox",
      present: true,
      folder: { id: "inbox", role: "INBOX", isPrimary: true },
    },
  ],
}));
const drafts: Record<string, unknown>[] = [];
const receivedRows = messages.map((m) => ({
  ...m,
  kind: "RECEIVED",
  at: m.receivedAt,
  preview: m.text,
  mailboxEmail: account.email,
  smtpConnectionId: null,
  status: null,
  read: Boolean(m.readAt),
  label: "Received",
}));
const sentRows = receivedRows
  .slice(0, 4)
  .map((m, i) => ({
    ...m,
    id: `sent-${i}`,
    kind: "SENT",
    inboxAccountId: null,
    smtpConnectionId: account.id,
    to: [m.fromEmail],
    fromName: account.fromName,
    fromEmail: account.fromEmail,
    status: "SENT",
    read: true,
    label: "Sent",
  }));
Object.assign(api, {
  inboxUnreadCount: async () => ({ count: 3 }),
  listInboxAccounts: async () => [account],
  listInboxFolders: async () => [
    {
      id: "inbox",
      inboxAccountId: "mailbox",
      name: "Inbox",
      path: "INBOX",
      role: "INBOX",
      present: true,
    },
  ],
  listInboundMessages: async () => ({ data: messages }),
  getInboxConversation: async (id: string) => ({
    messages: [messages.find((m) => m.id === id) || messages[0]],
    outgoing: [],
  }),
  recentInboxMoves: async () => [],
  markInboundMessageRead: async (id: string) =>
    messages.find((m) => m.id === id),
  markInboundMessagesRead: async () => ({ updated: 1 }),
  markInboundMessageFlagged: async (id: string) =>
    messages.find((m) => m.id === id),
  listSMTPConnections: async () => [account],
  listSendableSMTPConnections: async () => [account],
  listRecipientSuggestions: async () => [],
  listTemplates: async () => [],
  listContacts: async () => [],
  listContactLists: async () => [],
  listEmailDrafts: async () => drafts,
  recipientSuggestions: async () => [],
  listMailSignatures: async () => [],
  searchMail: async (_org: string, input: { view?: string; q?: string }) => {
    const rows =
      input.view === "SENT"
        ? sentRows
        : input.view === "OUTBOX"
          ? []
          : input.view === "DRAFTS"
            ? drafts.map((draft) => ({
                ...draft,
                kind: "DRAFT",
                at: draft.updatedAt,
                preview: draft.html || "",
                to: draft.to || [],
                read: true,
                label: "Personal draft",
                fromEmail: account.email,
                mailboxEmail: account.email,
              }))
            : input.view === "RECEIVED"
              ? receivedRows
              : [...receivedRows, ...sentRows];
    return {
      rows: rows.filter(
        (row) =>
          !input.q ||
          JSON.stringify(row).toLowerCase().includes(input.q.toLowerCase())
      ),
      nextCursor: null,
    };
  },
  outgoingMail: async (id: string) => {
    const row = sentRows.find((item) => item.id === id) ?? sentRows[0];
    return {
      ...row,
      origin: "MANUAL",
      createdAt: row.at,
      sentAt: row.at,
      cc: [],
      bcc: [],
      replyTo: null,
      campaignId: null,
      campaignName: null,
      sendingAccount: account,
      delivered: false,
      bounced: false,
      complained: false,
      opens: 0,
      clicks: 0,
      html: null,
      text: row.preview,
      attachments: [],
      events: [
        {
          id: "event-sent",
          type: "SENT",
          occurredAt: row.at,
          detail: null,
          count: 1,
          lastOccurredAt: null,
          automatedCount: 0,
        },
      ],
      failureReason: null,
    };
  },
  searchableMailboxes: async () => [
    { email: account.email, name: account.name },
  ],
  createEmailDraft: async (input: Record<string, unknown>) => {
    const draft = {
      ...input,
      id: "draft-1",
      revision: 1,
      createdByUserId: "preview",
      updatedAt: new Date().toISOString(),
    };
    drafts.push(draft);
    return draft;
  },
  updateEmailDraft: async (id: string, input: Record<string, unknown>) => {
    const index = drafts.findIndex((draft) => draft.id === id);
    const draft = {
      ...(drafts[index] ?? {}),
      ...input,
      id,
      revision: Number(drafts[index]?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    if (index >= 0) drafts[index] = draft;
    return draft;
  },
  getEmailDraft: async () => drafts[0],
  touchReplyPresence: async () => ({
    expiresAt: new Date(Date.now() + 45000).toISOString(),
  }),
  leaveReplyPresence: async () => ({ left: true }),
});
api.setupStatus = async () => ({
  needsSetup: false,
  setupCompleted: true,
  allowPublicRegistration: false,
});
window.fetch = async () => {
  throw new Error("Network disabled in the synthetic mail preview");
};
saveSession({
  user: { id: "preview", email: "nana@qqueue.test", name: "Nana Boateng" },
  accessToken: "local-fixture-only",
  organizations: [{ id: "demo", name: "QQueue", role: "OWNER" }],
  currentOrganizationId: "demo",
});
const client = createQueryClient();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <TooltipProvider>
      <SessionProvider>
        <MemoryRouter initialEntries={["/inbox"]}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    </TooltipProvider>
  </QueryClientProvider>
);
