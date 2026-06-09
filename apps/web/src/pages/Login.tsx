import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { saveSession } from "../lib/session.js";

export function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("password123");
  const [name, setName] = useState("Admin");
  const [organizationName, setOrganizationName] = useState("Acme");
  const [status, setStatus] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus(undefined);

    try {
      if (mode === "register") {
        const result = await api.register({
          email,
          password,
          name,
          organizationName
        });
        saveSession({
          user: result.user,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          currentOrganizationId: result.organization.id,
          organizations: [{ id: result.organization.id, name: result.organization.name }]
        });
      } else {
        const result = await api.login({ email, password });
        saveSession({
          user: result.user,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          currentOrganizationId: result.organizations[0]?.id,
          organizations: result.organizations
        });
      }

      navigate("/");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-ink">
          {mode === "login" ? "Sign in to QQueue" : "Create QQueue account"}
        </h1>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          {mode === "register" ? (
            <>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Organization
                </span>
                <input
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
            </>
          ) : null}
          {status ? <p className="text-sm text-coral">{status}</p> : null}
          <button
            type="submit"
            className="w-full rounded-md bg-moss px-4 py-2 font-medium text-white"
          >
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="mt-4 w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
        >
          {mode === "login" ? "Create an account" : "Use existing account"}
        </button>
      </section>
    </main>
  );
}
