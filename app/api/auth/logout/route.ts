import { signOut } from "@workos-inc/authkit-nextjs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") ?? new URL("/", url).toString();

  await signOut({ returnTo });
}
