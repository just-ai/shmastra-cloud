import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface User {
  id: string;
  workos_id: string;
  email: string;
  virtual_key: string | null;
  project_token: string;
  created_at: string;
}

export interface Project {
  user_id: string;
  project_id: number;
  git_url: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sandbox {
  id: string;
  user_id: string;
  sandbox_id: string | null;
  sandbox_host: string | null;
  status: string;
  ready_token: string | null;
  error_message: string | null;
  version: string | null;
  last_extended_at: string | null;
  created_at: string;
  updated_at: string;
}

let _supabase: SupabaseClient;

export function db() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

// --- Users ---

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateVirtualKey(userId: string): string {
  return `vk_${userId}_${randomHex(12)}`;
}

export function generateProjectToken(userId: string): string {
  return `pjt_${userId}_${randomHex(16)}`;
}

export async function upsertUser(workosId: string, email: string) {
  // Try to find existing user first
  const existing = await getUserByWorkosId(workosId);
  if (existing) return existing.id as string;

  // New user — generate virtual key at creation time
  const id = crypto.randomUUID();
  const { data, error } = await db()
    .from("users")
    .insert({
      id,
      workos_id: workosId,
      email,
      virtual_key: generateVirtualKey(id),
      project_token: generateProjectToken(id),
    })
    .select("id")
    .single();
  if (error) {
    // Race condition: another request created the user
    if (error.code === "23505") {
      const raced = await getUserByWorkosId(workosId);
      if (raced) return raced.id as string;
    }
    throw error;
  }
  return data.id as string;
}

export async function getUserById(userId: string) {
  const { data, error } = await db()
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getUserByWorkosId(workosId: string) {
  const { data, error } = await db()
    .from("users")
    .select("*")
    .eq("workos_id", workosId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

// --- Projects ---

export async function getProject(userId: string): Promise<Project | null> {
  const { data, error } = await db()
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<Project>();
  if (error) throw error;
  return data;
}

export async function upsertProject(row: {
  user_id: string;
  project_id: number;
  git_url: string;
}): Promise<{ row: Project; inserted: boolean }> {
  // Insert; on user_id collision (a concurrent caller won the race), fetch
  // the winning row and report `inserted: false` so caller can clean up.
  const { data, error } = await db()
    .from("projects")
    .insert(row)
    .select()
    .maybeSingle<Project>();
  if (!error && data) return { row: data, inserted: true };
  if (error && error.code !== "23505") throw error;

  const winner = await getProject(row.user_id);
  if (!winner) throw new Error("Project insert raced but no winning row found");
  return { row: winner, inserted: false };
}

export async function markProjectError(userId: string, message: string): Promise<void> {
  const { error } = await db()
    .from("projects")
    .update({ error: message, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function touchProject(userId: string): Promise<void> {
  const { error } = await db()
    .from("projects")
    .update({ updated_at: new Date().toISOString(), error: null })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function deleteProject(userId: string): Promise<void> {
  const { error } = await db().from("projects").delete().eq("user_id", userId);
  if (error) throw error;
}

// --- Sandboxes ---

export async function getSandbox(userId: string) {
  const { data, error } = await db()
    .from("sandboxes")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function createSandboxRecord(userId: string) {
  const { data, error } = await db()
    .from("sandboxes")
    .insert({
      user_id: userId,
      status: "creating",
    })
    .select()
    .single();

  if (error) {
    // Another request may have created the record concurrently.
    if (error.code === "23505") {
      const existing = await getSandbox(userId);
      if (existing) {
        return { sandbox: existing, created: false as const };
      }
    }

    throw error;
  }

  return { sandbox: data, created: true as const };
}

export async function updateSandbox(
  userId: string,
  updates: {
    sandbox_id?: string;
    sandbox_host?: string;
    status?: string;
    error_message?: string | null;
    version?: string | null;
  },
) {
  const { error } = await db()
    .from("sandboxes")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function markSandboxCreating(userId: string) {
  const { error } = await db()
    .from("sandboxes")
    .update({
      status: "creating",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function getSandboxExtendInfo(userId: string) {
  const { data, error } = await db()
    .from("sandboxes")
    .select("sandbox_id, last_extended_at")
    .eq("user_id", userId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data as { sandbox_id: string; last_extended_at: string | null } | null;
}

export async function updateLastExtendedAt(userId: string) {
  const { error } = await db()
    .from("sandboxes")
    .update({ last_extended_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function claimSandboxRetry(userId: string) {
  const { data, error } = await db()
    .from("sandboxes")
    .update({
      status: "creating",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "error")
    .select()
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

// --- App shares ---

export interface AppShare {
  id: string;
  owner_user_id: string;
  app_name: string;
  created_at: string;
  revoked: boolean;
}

export interface AppShareSession {
  id: string;
  share_id: string;
  viewer_user_id: string;
  session_vk: string;
  created_at: string;
}

export async function getShareById(id: string) {
  const { data, error } = await db()
    .from("app_shares")
    .select("*")
    .eq("id", id)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data as AppShare | null;
}

export async function getShareByOwnerAndApp(ownerUserId: string, appName: string) {
  const { data, error } = await db()
    .from("app_shares")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("app_name", appName)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return data as AppShare | null;
}

export async function listSharesByOwner(ownerUserId: string) {
  const { data, error } = await db()
    .from("app_shares")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppShare[];
}

export async function insertShareRow(row: {
  id: string;
  owner_user_id: string;
  app_name: string;
}) {
  const { data, error } = await db()
    .from("app_shares")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as AppShare;
}

export async function softDeleteShareRow(id: string, ownerUserId: string) {
  const { error } = await db()
    .from("app_shares")
    .update({ revoked: true })
    .eq("id", id)
    .eq("owner_user_id", ownerUserId);
  if (error) throw error;
}

export async function restoreShareRow(id: string, ownerUserId: string) {
  const { data, error } = await db()
    .from("app_shares")
    .update({ revoked: false })
    .eq("id", id)
    .eq("owner_user_id", ownerUserId)
    .select()
    .single();
  if (error) throw error;
  return data as AppShare;
}

export async function deleteSessionsForShare(shareId: string) {
  const { error } = await db()
    .from("app_share_sessions")
    .delete()
    .eq("share_id", shareId);
  if (error) throw error;
}

export async function getSessionByShareAndViewer(
  shareId: string,
  viewerUserId: string,
) {
  const { data, error } = await db()
    .from("app_share_sessions")
    .select("*")
    .eq("share_id", shareId)
    .eq("viewer_user_id", viewerUserId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return data as AppShareSession | null;
}

export async function insertSessionRow(row: {
  id: string;
  share_id: string;
  viewer_user_id: string;
  session_vk: string;
}) {
  const { data, error } = await db()
    .from("app_share_sessions")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as AppShareSession;
}

export async function listSessionsForOwner(ownerUserId: string) {
  const { data, error } = await db()
    .from("app_share_sessions")
    .select("id, share:app_shares!inner(owner_user_id)")
    .eq("share.owner_user_id", ownerUserId);
  if (error) throw error;
  return (data ?? []) as { id: string }[];
}

export async function getSessionBySessionVk(sessionVk: string) {
  const { data, error } = await db()
    .from("app_share_sessions")
    .select("id, share_id, viewer_user_id, share:app_shares!inner(owner_user_id)")
    .eq("session_vk", sessionVk)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  if (!data) return null;
  const share = (data as { share: { owner_user_id: string } | { owner_user_id: string }[] }).share;
  const ownerUserId = Array.isArray(share) ? share[0]?.owner_user_id : share?.owner_user_id;
  if (!ownerUserId) return null;
  return {
    sessionId: data.id as string,
    shareId: data.share_id as string,
    viewerUserId: data.viewer_user_id as string,
    ownerUserId,
  };
}
