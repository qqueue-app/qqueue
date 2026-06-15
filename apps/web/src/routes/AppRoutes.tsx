import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
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
const SendEmail = lazy(() =>
  import("../pages/SendEmail.js").then((module) => ({
    default: module.SendEmail,
  }))
);
const EmailStudio = lazy(() =>
  import("../pages/EmailStudio.js").then((module) => ({
    default: module.EmailStudio,
  }))
);
const SMTPConnections = lazy(() =>
  import("../pages/SMTPConnections.js").then((module) => ({
    default: module.SMTPConnections,
  }))
);
const Templates = lazy(() =>
  import("../pages/Templates.js").then((module) => ({
    default: module.Templates,
  }))
);
const Suppressions = lazy(() =>
  import("../pages/Suppressions.js").then((module) => ({
    default: module.Suppressions,
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
          <Route path="/send-email" element={<SendEmail />} />
          <Route path="/smtp-connections" element={<SMTPConnections />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/suppressions" element={<Suppressions />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/lists" element={<ContactLists />} />
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
