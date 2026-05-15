import { redirect } from "next/navigation";
import { sanitizeReturnTo } from "@/lib/return-to";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const returnTo = sanitizeReturnTo((await searchParams).returnTo);
  redirect(returnTo ? `/?returnTo=${encodeURIComponent(returnTo)}` : "/");
}
