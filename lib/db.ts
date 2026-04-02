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

export async function upsertUser(workosId: string, email: string) {
  const { data, error } = await db()
    .from("users")
    .upsert({ workos_id: workosId, email }, { onConflict: "workos_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
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
