import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "../layouts/DashboardLayout.js";
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
const SMTPConnections = lazy(() =>
  import("../pages/SMTPConnections.js").then((module) => ({
    default: module.SMTPConnections,
  }))
);
const SendingDomains = lazy(() =>
  import("../pages/SendingDomains.js").then((module) => ({
    default: module.SendingDomains,
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
      <Routes>
        <Route path="/login" element={<Login mode="login" />} />
        <Route path="/register" element={<Login mode="register" />} />
        <Route path="/forgot-password" element={<Login mode="forgot" />} />
        <Route path="/reset-password" element={<Login mode="reset" />} />
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/licensing" element={<LegalPage kind="licensing" />} />
        <Route path="/trademark" element={<LegalPage kind="trademark" />} />
        <Route element={<DashboardLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/email-studio" element={<EmailStudio />} />
          <Route path="/inbox" element={<Inbox />} />
          {/* The standalone Send Email page was merged into Email Studio. */}
          <Route
            path="/send-email"
            element={<Navigate to="/email-studio" replace />}
          />
          <Route path="/smtp-connections" element={<SMTPConnections />} />
          <Route path="/sending-domains" element={<SendingDomains />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/suppressions" element={<Suppressions />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/templates/new" element={<TemplateEditor />} />
          <Route path="/templates/:id/edit" element={<TemplateEditor />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/lists" element={<ContactLists />} />
          <Route path="/campaigns/segments" element={<Segments />} />
          <Route path="/deliverability" element={<Deliverability />} />
          <Route
            path="/campaigns/:id/analytics"
            element={<CampaignAnalytics />}
          />
          <Route path="/queue-operations" element={<QueueOperations />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
