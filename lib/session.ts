import { withAuth } from "@workos-inc/authkit-nextjs";

export async function getSessionOrThrow() {
  const session = await withAuth({ ensureSignedIn: true });
  return session;
}
