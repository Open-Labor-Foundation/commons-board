"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { status, data } = await apiPost<{ error?: string }>("/api/v1/auth/login", {
      user_id: userId.trim(),
      password,
    });

    setLoading(false);

    if (status === 200) {
      router.replace("/");
      return;
    }

    setError(data?.error ?? "Login failed");
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "var(--bg)",
    }}>
      <div style={{
        width: 340,
        padding: 32,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>commons-board</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>Sign in to your workspace</p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
              User ID
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              autoFocus
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                fontSize: 14,
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                fontSize: 14,
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>
          {error && (
            <p style={{ fontSize: 13, color: "#dc2626", margin: 0 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "10px 16px",
              background: "var(--brand)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius)",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}