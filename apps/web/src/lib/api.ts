const apiBaseUrl =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

export interface ApiEnvelope<T> {
  data: T;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  organizationId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
}

export interface Template {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  html: string;
  text?: string | null;
}

export interface SMTPConnection {
  id: string;
  organizationId: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  fromEmail: string;
  fromName?: string | null;
  isDefault: boolean;
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(
      body && "error" in body && body.error?.message
        ? body.error.message
        : "Request failed"
    );
  }

  return (body as ApiEnvelope<T>).data;
}

export const api = {
  register(input: {
    email: string;
    password: string;
    name?: string;
    organizationName?: string;
  }) {
    return request<{
      user: { id: string; email: string; name?: string | null };
      organization: Organization;
      tokens: { accessToken: string; refreshToken: string };
    }>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  login(input: { email: string; password: string }) {
    return request<{
      user: { id: string; email: string; name?: string | null };
      organizations: Array<{ id: string; name: string; role: string }>;
      tokens: { accessToken: string; refreshToken: string };
    }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  listOrganizations() {
    return request<Organization[]>("/api/v1/organizations");
  },

  createOrganization(input: { name: string }) {
    return request<Organization>("/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  listSMTPConnections(organizationId: string) {
    return request<SMTPConnection[]>(
      `/api/v1/smtp-connections?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createSMTPConnection(input: Record<string, unknown>) {
    return request<SMTPConnection>("/api/v1/smtp-connections", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  deleteSMTPConnection(id: string) {
    return request<void>(`/api/v1/smtp-connections/${id}`, { method: "DELETE" });
  },

  testSMTPConnection(id: string) {
    return request<{ id: string; ok: boolean }>(
      `/api/v1/smtp-connections/${id}/test`,
      { method: "POST" }
    );
  },

  listContacts(organizationId: string) {
    return request<Contact[]>(
      `/api/v1/contacts?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createContact(input: Record<string, unknown>) {
    return request<Contact>("/api/v1/contacts", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  deleteContact(id: string) {
    return request<void>(`/api/v1/contacts/${id}`, { method: "DELETE" });
  },

  listTemplates(organizationId: string) {
    return request<Template[]>(
      `/api/v1/templates?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createTemplate(input: Record<string, unknown>) {
    return request<Template>("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  deleteTemplate(id: string) {
    return request<void>(`/api/v1/templates/${id}`, { method: "DELETE" });
  },

  sendEmail(input: Record<string, unknown>) {
    return request<{ emailJob: { id: string; status: string } }>(
      "/api/v1/transactional-email/send",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
  }
};
