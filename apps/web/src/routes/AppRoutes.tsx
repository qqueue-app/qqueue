import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "../layouts/DashboardLayout.js";
import { SetupGate } from "../components/SetupGate.js";
import { Skeleton } from "../components/ui/skeleton.js";

const Campaigns = lazy(() =>
  import("../pages/Campaigns.js").then((module) => ({
    default: module.Campaigns,
  }))
);
const CampaignAnalytics = lazy(() =>
  import("../pages/CampaignAnalytics.js").then((module) => ({
    default: module.CampaignAnalytics,
  }))
);
const Contacts = lazy(() =>
  import("../pages/Contacts.js").then((module) => ({
    default: module.Contacts,
  }))
);
const ContactLists = lazy(() =>
  import("../pages/ContactLists.js").then((module) => ({
    default: module.ContactLists,
  }))
);
const Dashboard = lazy(() =>
  import("../pages/Dashboard.js").then((module) => ({
    default: module.Dashboard,
  }))
);
const Login = lazy(() =>
  import("../pages/Login.js").then((module) => ({
    default: module.Login,
  }))
);
const Setup = lazy(() =>
  import("../pages/Setup.js").then((module) => ({
    default: module.Setup,
  }))
);
const AcceptInvite = lazy(() =>
  import("../pages/AcceptInvite.js").then((module) => ({
    default: module.AcceptInvite,
  }))
);
const LegalPage = lazy(() =>
  import("../pages/Legal.js").then((module) => ({
    default: module.LegalPage,
  }))
);
const Settings = lazy(() =>
  import("../pages/Settings.js").then((module) => ({
    default: module.Settings,
  }))
);
const QueueOperations = lazy(() =>
  import("../pages/QueueOperations.js").then((module) => ({
    default: module.QueueOperations,
  }))
);
const EmailStudio = lazy(() =>
  import("../pages/EmailStudio.js").then((module) => ({
    default: module.EmailStudio,
  }))
);
const Inbox = lazy(() =>
  import("../pages/Inbox.js").then((module) => ({
    default: module.Inbox,
  }))
);
const Drafts = lazy(() =>
  import("../pages/Drafts.js").then((module) => ({
    default: module.Drafts,
  }))
);
const Outbox = lazy(() =>
  import("../pages/Outbox.js").then((module) => ({
    default: module.Outbox,
  }))
);
const SMTPConnections = lazy(() =>
  import("../pages/SMTPConnections.js").then((module) => ({
    default: module.SMTPConnections,
  }))
);
const Mailboxes = lazy(() =>
  import("../pages/Mailboxes.js").then((module) => ({
    default: module.Mailboxes,
  }))
);
const Templates = lazy(() =>
  import("../pages/Templates.js").then((module) => ({
    default: module.Templates,
  }))
);
const TemplateEditor = lazy(() =>
  import("../pages/TemplateEditor.js").then((module) => ({
    default: module.TemplateEditor,
  }))
);
const Suppressions = lazy(() =>
  import("../pages/Suppressions.js").then((module) => ({
    default: module.Suppressions,
  }))
);
const Segments = lazy(() =>
  import("../pages/Segments.js").then((module) => ({
    default: module.Segments,
  }))
);
/*
  The design-system reference page. Dev-only: it documents the foundation for
  whoever is building on it, and has no place in a production bundle.
*/
const DesignSystem = lazy(() =>
  import("../pages/DesignSystem.js").then((module) => ({
    default: module.DesignSystem,
  }))
);
const Deliverability = lazy(() =>
  import("../pages/Deliverability.js").then((module) => ({
    default: module.Deliverability,
  }))
);

function RouteFallback() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <SetupGate>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Login mode="login" />} />
        <Route path="/register" element={<Login mode="register" />} />
        <Route path="/forgot-password" element={<Login mode="forgot" />} />
        <Route path="/reset-password" element={<Login mode="reset" />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        {import.meta.env.DEV ? (
          <Route path="/design-system" element={<DesignSystem />} />
        ) : null}
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/licensing" element={<LegalPage kind="licensing" />} />
        <Route path="/trademark" element={<LegalPage kind="trademark" />} />
        <Route element={<DashboardLayout />}>
          {/* Signing in lands on mail, the way every email client does. The
              stats page still exists, but you go to it deliberately. */}
          <Route index element={<Inbox />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/insights" element={<Dashboard />} />
          {/* Bookmarks and old links to the stats-first home. */}
          <Route path="/dashboard" element={<Navigate to="/insights" replace />} />
          <Route path="/email-studio" element={<EmailStudio />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/outbox" element={<Outbox />} />
          {/* The standalone Send Email page was merged into Email Studio. */}
          <Route
            path="/send-email"
            element={<Navigate to="/email-studio" replace />}
          />
          <Route path="/smtp-connections" element={<SMTPConnections />} />
          <Route path="/mailboxes" element={<Mailboxes />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/suppressions" element={<Suppressions />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/templates/new" element={<TemplateEditor />} />
          <Route path="/templates/:id/edit" element={<TemplateEditor />} />
          <Route path="/campaigns" element={<Campaigns />} />
          {/* Smart lists are a tab of Lists now, not a sibling destination —
              see §4. The old path still works so existing links don't rot. */}
          <Route path="/campaigns/lists" element={<ContactLists />} />
          <Route path="/campaigns/lists/smart" element={<Segments />} />
          <Route
            path="/campaigns/segments"
            element={<Navigate to="/campaigns/lists/smart" replace />}
          />
          <Route path="/deliverability" element={<Deliverability />} />
          <Route
            path="/campaigns/:id/analytics"
            element={<CampaignAnalytics />}
          />
          <Route path="/queue-operations" element={<QueueOperations />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
      </SetupGate>
    </Suspense>
  );
}
