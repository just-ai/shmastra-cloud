import type { Sandbox as E2BSandbox } from "e2b";
import {
  AppShare,
  AppShareSession,
  db,
  deleteShareRow,
  getSandbox,
  getShareByOwnerAndApp,
  getSessionByShareAndViewer,
  insertSessionRow,
  insertShareRow,
} from "./db";
import { connectToSandbox } from "./sandbox";

const SESSIONS_DIR = "/home/user/shmastra/.sessions";
const SLUG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomSlug(length = 10): string {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < length; i++) out += SLUG_ALPHABET[buf[i] % SLUG_ALPHABET.length];
  return out;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sessionTokenId(): string {
  return `st_${randomHex(8)}`; // 16 hex chars
}

function sessionVk(viewerUserId: string): string {
  return `sk_${viewerUserId}_${randomHex(12)}`;
}

export function shareUrlPath(shareId: string): string {
  return `/apps/shared/${shareId}`;
}

export async function createShare(ownerUserId: string, appName: string): Promise<AppShare> {
  const existing = await getShareByOwnerAndApp(ownerUserId, appName);
  if (existing) return existing;

  // Slug only has [A-Za-z0-9] so the appName-slug boundary is unambiguous.
  const id = `${appName}-${randomSlug()}`;
  try {
    return await insertShareRow({ id, owner_user_id: ownerUserId, app_name: appName });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      // Raced with another request — return the winner.
      const raced = await getShareByOwnerAndApp(ownerUserId, appName);
      if (raced) return raced;
    }
    throw err;
  }
}

export async function revokeShare(shareId: string, ownerUserId: string): Promise<void> {
  // Gather session ids BEFORE deleting (cascade strips them). Then wipe files
  // from the sandbox (auto-resumes if paused), then drop the DB row.
  const { data: sessions, error } = await db()
    .from("app_share_sessions")
    .select("id")
    .eq("share_id", shareId);
  if (error) throw error;

  const sandboxRecord = await getSandbox(ownerUserId);
  if (sandboxRecord?.sandbox_id && sessions && sessions.length > 0) {
    try {
      const sandbox = await connectToSandbox(sandboxRecord.sandbox_id);
      for (const session of sessions) {
        try {
          await sandbox.files.remove(`${SESSIONS_DIR}/${session.id}.json`);
        } catch {
          // already gone — ignore
        }
      }
    } catch (err) {
      console.error("revokeShare: failed to wipe session files", err);
    }
  }

  await deleteShareRow(shareId, ownerUserId);
}

export async function getOrCreateSession(
  shareId: string,
  viewerUserId: string,
): Promise<AppShareSession> {
  const existing = await getSessionByShareAndViewer(shareId, viewerUserId);
  if (existing) return existing;

  const row = {
    id: sessionTokenId(),
    share_id: shareId,
    viewer_user_id: viewerUserId,
    session_vk: sessionVk(viewerUserId),
  };
  try {
    return await insertSessionRow(row);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      const raced = await getSessionByShareAndViewer(shareId, viewerUserId);
      if (raced) return raced;
    }
    throw err;
  }
}

export async function writeSessionFile(
  sandbox: E2BSandbox,
  session: AppShareSession,
  share: AppShare,
): Promise<void> {
  const referrer = shareUrlPath(share.id);
  const payload = {
    sessionId: session.id,
    sessionVk: session.session_vk,
    viewerUserId: session.viewer_user_id,
    referrer,
  };
  await sandbox.files.makeDir(SESSIONS_DIR).catch(() => undefined);
  await sandbox.files.write(`${SESSIONS_DIR}/${session.id}.json`, JSON.stringify(payload));
}
