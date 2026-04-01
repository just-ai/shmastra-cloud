"use server";

import { redirect } from "next/navigation";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";

export async function startSignIn() {
  const signInUrl = await getSignInUrl({
    returnTo: "/workspace",
  });

  redirect(signInUrl);
}
