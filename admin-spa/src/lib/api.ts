"use client";
import { CONFIG } from "./config";
import { currentSession, logout } from "./auth";

async function authHeader(): Promise<Record<string, string>> {
  const session = await currentSession();
  if (!session) {
    logout();
    if (typeof window !== "undefined") window.location.assign("/login");
    throw new Error("no session");
  }
  return {
    Authorization: session.getIdToken().getJwtToken(),
    "Content-Type": "application/json",
  };
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${CONFIG.apiUrl}${path}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CONFIG.apiUrl}${path}`, {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
