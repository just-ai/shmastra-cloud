import { db, getSessionBySessionVk } from "./db";

export interface ResolvedKey {
  userId: string;             // billing target — always the owner account
  sessionId?: string;         // present when key is a session VK (sk_*)
  viewerUserId?: string;
  shareId?: string;
}

export async function resolveVirtualKey(vk: string): Promise<ResolvedKey | null> {
  if (vk.startsWith("vk_")) {
    const { data, error } = await db()
      .from("users")
      .select("id")
      .eq("virtual_key", vk)
      .single();
    if (error || !data) return null;
    return { userId: data.id as string };
  }

  if (vk.startsWith("sk_")) {
    const session = await getSessionBySessionVk(vk);
    if (!session) return null;
    return {
      userId: session.ownerUserId,
      sessionId: session.sessionId,
      viewerUserId: session.viewerUserId,
      shareId: session.shareId,
    };
  }

  return null;
}

export function getVirtualKey(user: { id: string; virtual_key?: string | null }): string {
  if (user.virtual_key) return user.virtual_key;
  throw new Error(`User ${user.id} has no virtual key`);
}
