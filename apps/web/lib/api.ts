export function apiHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-workspace-id": process.env.NEXT_PUBLIC_COMMONS_WORKSPACE_ID ?? "default",
    "x-user-id": process.env.NEXT_PUBLIC_COMMONS_USER_ID ?? "operator",
    "x-user-role": process.env.NEXT_PUBLIC_COMMONS_USER_ROLE ?? "admin",
  };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, { ...init, headers: { ...apiHeaders(), ...(init?.headers ?? {}) } });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<{ data: T | null; status: number }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(body),
    });
    const data = res.ok ? ((await res.json()) as T) : null;
    return { data, status: res.status };
  } catch {
    return { data: null, status: 0 };
  }
}

export async function apiPut<T>(path: string, body: unknown): Promise<{ data: T | null; status: number }> {
  try {
    const res = await fetch(path, {
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify(body),
    });
    const data = res.ok ? ((await res.json()) as T) : null;
    return { data, status: res.status };
  } catch {
    return { data: null, status: 0 };
  }
}

export async function apiPatch<T>(path: string, body: unknown): Promise<{ data: T | null; status: number }> {
  try {
    const res = await fetch(path, {
      method: "PATCH",
      headers: apiHeaders(),
      body: JSON.stringify(body),
    });
    const data = res.ok ? ((await res.json()) as T) : null;
    return { data, status: res.status };
  } catch {
    return { data: null, status: 0 };
  }
}

export async function apiDelete(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "DELETE", headers: apiHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusColor(status: string): string {
  const m: Record<string, string> = {
    pending: "#d97706", executing: "#0369a1", running: "#0369a1",
    completed: "#16a34a", executed: "#16a34a", active: "#16a34a", healthy: "#16a34a",
    failed: "#dc2626", error: "#dc2626", blocked: "#7c3aed",
    submitted: "#0369a1", triaged: "#7c3aed", approved: "#16a34a",
    draft: "#64748b", paused: "#d97706",
  };
  return m[status] ?? "#64748b";
}
