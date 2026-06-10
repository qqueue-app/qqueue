import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { DashboardLayout } from "../layouts/DashboardLayout.js";
import { Skeleton } from "../components/ui/skeleton.js";

const Campaigns = lazy(() =>
  import("../pages/Campaigns.js").then((module) => ({
    default: module.Campaigns
  }))
);
const Contacts = lazy(() =>
  import("../pages/Contacts.js").then((module) => ({
    default: module.Contacts
  }))
);
const ContactLists = lazy(() =>
  import("../pages/ContactLists.js").then((module) => ({
    default: module.ContactLists
  }))
);
const Dashboard = lazy(() =>
  import("../pages/Dashboard.js").then((module) => ({
    default: module.Dashboard
  }))
);
const Login = lazy(() =>
  import("../pages/Login.js").then((module) => ({
    default: module.Login
  }))
);
const Settings = lazy(() =>
  import("../pages/Settings.js").then((module) => ({
    default: module.Settings
  }))
);
const SendEmail = lazy(() =>
  import("../pages/SendEmail.js").then((module) => ({
    default: module.SendEmail
  }))
);
const SMTPConnections = lazy(() =>
  import("../pages/SMTPConnections.js").then((module) => ({
    default: module.SMTPConnections
  }))
);
const Templates = lazy(() =>
  import("../pages/Templates.js").then((module) => ({
    default: module.Templates
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
        <Route element={<DashboardLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/send-email" element={<SendEmail />} />
          <Route path="/smtp-connections" element={<SMTPConnections />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/lists" element={<ContactLists />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
