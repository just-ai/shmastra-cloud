import { db } from "./db";

export async function resolveVirtualKey(
  vk: string,
): Promise<{ userId: string } | null> {
  if (!vk.startsWith("vk_")) return null;

  const { data, error } = await db()
    .from("users")
    .select("id")
    .eq("virtual_key", vk)
    .single();

  if (error || !data) return null;
  return { userId: data.id };
}

export function getVirtualKey(user: { id: string; virtual_key?: string | null }): string {
  if (user.virtual_key) return user.virtual_key;
  throw new Error(`User ${user.id} has no virtual key`);
}
