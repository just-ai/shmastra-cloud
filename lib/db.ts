import { createClient, SupabaseClient } from "@supabase/supabase-js";

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

function generateVirtualKey(userId: string): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `vk_${userId}_${hex}`;
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
