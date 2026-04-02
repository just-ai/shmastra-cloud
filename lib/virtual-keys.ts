import { db } from "./db";

function generateHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getOrCreateVirtualKey(userId: string): Promise<string> {
  const { data } = await db()
    .from("virtual_keys")
    .select("virtual_key")
    .eq("user_id", userId)
    .single();

  if (data) return data.virtual_key;

  const hex = generateHex(12); // 24 hex chars
  const virtualKey = `vk_${userId}_${hex}`;

  const { error } = await db()
    .from("virtual_keys")
    .insert({ user_id: userId, virtual_key: virtualKey });
  if (error) throw error;

  return virtualKey;
}

export async function resolveVirtualKey(
  vk: string,
): Promise<{ userId: string } | null> {
  if (!vk.startsWith("vk_")) return null;

  const { data, error } = await db()
    .from("virtual_keys")
    .select("user_id")
    .eq("virtual_key", vk)
    .single();

  if (error || !data) return null;
  return { userId: data.user_id };
}
