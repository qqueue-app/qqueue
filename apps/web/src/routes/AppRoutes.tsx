import { Route, Routes } from "react-router-dom";
import { DashboardLayout } from "../layouts/DashboardLayout.js";
import { Campaigns } from "../pages/Campaigns.js";
import { Contacts } from "../pages/Contacts.js";
import { Dashboard } from "../pages/Dashboard.js";
import { Login } from "../pages/Login.js";
import { Settings } from "../pages/Settings.js";
import { SMTPConnections } from "../pages/SMTPConnections.js";
import { Templates } from "../pages/Templates.js";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<DashboardLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="/smtp-connections" element={<SMTPConnections />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
