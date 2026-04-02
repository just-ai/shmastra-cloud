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

export async function createUserWithId(
  id: string,
  workosId: string,
  email: string,
) {
  const { data, error } = await db()
    .from("users")
    .insert({ id, workos_id: workosId, email })
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
    .eq("claimed", true)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function createSandboxRecord(userId: string) {
  const { data, error } = await db()
    .from("sandboxes")
    .insert({
      user_id: userId,
      claimed: true,
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

export async function createPoolSandboxRecord(
  userId: string,
  virtualKey: string,
) {
  const { data, error } = await db()
    .from("sandboxes")
    .insert({
      user_id: userId,
      virtual_key: virtualKey,
      claimed: false,
      status: "creating",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function countPoolSandboxes() {
  const { count, error } = await db()
    .from("sandboxes")
    .select("*", { count: "exact", head: true })
    .eq("claimed", false)
    .not("sandbox_id", "is", null);
  if (error) throw error;
  return count ?? 0;
}

export async function claimPoolSandbox() {
  const { data: row, error: selectError } = await db()
    .from("sandboxes")
    .select("id")
    .eq("claimed", false)
    .not("sandbox_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!row) return null;

  const { data, error } = await db()
    .from("sandboxes")
    .update({ claimed: true, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .select()
    .single();
  if (error) throw error;
  return data;
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

export async function updateSandboxById(
  id: string,
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
    .eq("id", id);
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

// --- Virtual keys (now stored in sandboxes table) ---

export async function resolveVirtualKey(
  vk: string,
): Promise<{ userId: string } | null> {
  if (!vk.startsWith("vk_")) return null;

  const { data, error } = await db()
    .from("sandboxes")
    .select("user_id")
    .eq("virtual_key", vk)
    .single();

  if (error || !data) return null;
  return { userId: data.user_id };
}
