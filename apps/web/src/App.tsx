import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./components/Layout";
import { PageProvider, SessionProvider, ToastProvider, usePage } from "./lib/session";
import { AccountPage } from "./pages/Account";
import { AdminAuditPage, AdminSystemPage, AdminUsersPage } from "./pages/Admin";
import { AssessmentPage } from "./pages/Assessment";
import { ForgotPassword, Register, SignIn } from "./pages/auth";
import { Dashboard } from "./pages/Dashboard";
import { ComparePage, ProjectPage } from "./pages/Project";
import { ReportPage } from "./pages/Report";

function NotFound() {
  usePage("Page not found");
  return (
    <div className="empty">
      <h3>This page doesn't exist</h3>
      <p>The link may be old, or the project may have been deleted.</p>
      <Link className="btn" to="/">Go to your projects</Link>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Dashboard />} />
        <Route path="projects/:projectId" element={<ProjectPage />} />
        <Route path="projects/:projectId/compare" element={<ComparePage />} />
        <Route path="assessments/:assessmentId" element={<AssessmentPage />} />
        <Route path="assessments/:assessmentId/report" element={<ReportPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="admin" element={<AdminUsersPage />} />
        <Route path="admin/audit" element={<AdminAuditPage />} />
        <Route path="admin/system" element={<AdminSystemPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <PageProvider>
            <AppRoutes />
          </PageProvider>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
