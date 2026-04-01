import { signOut } from "@workos-inc/authkit-nextjs";

export async function GET(request: Request) {
  const returnTo = new URL(request.url).searchParams.get("returnTo") || undefined;

  await signOut({ returnTo });
}
