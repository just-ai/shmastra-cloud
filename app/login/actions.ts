"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getWorkOS,
  saveSession,
} from "@workos-inc/authkit-nextjs";
import { isAllowedWorkosOrganization } from "@/lib/workos-organization";

export type EmailCodeActionState = {
  email: string;
  step: "email" | "code";
  error?: string;
  message?: string;
};

function normalizeEmail(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeCode(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getRequestOrigin() {
  const requestHeaders = await headers();
  const explicitOrigin =
    requestHeaders.get("origin") || requestHeaders.get("x-forwarded-origin");

  if (explicitOrigin) {
    return explicitOrigin;
  }

  const host =
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || "http";

  if (host) {
    return `${protocol}://${host}`;
  }

  return "http://localhost:3000";
}

function getClientIp(requestHeaders: Headers) {
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  if (!forwardedFor) {
    return undefined;
  }

  return forwardedFor.split(",")[0]?.trim() || undefined;
}

function buildCodeStepState(
  email: string,
  fields: Partial<Pick<EmailCodeActionState, "error" | "message">> = {},
): EmailCodeActionState {
  return {
    email,
    step: "code",
    ...fields,
  };
}

export async function requestMagicCode(
  _previousState: EmailCodeActionState,
  formData: FormData,
): Promise<EmailCodeActionState> {
  const email = normalizeEmail(formData.get("email"));

  if (!isValidEmail(email)) {
    return {
      email,
      step: "email",
      error: "Enter a valid email address.",
    };
  }

  try {
    await getWorkOS().userManagement.createMagicAuth({ email });
    return buildCodeStepState(email, {
      message: "We sent a one-time code to your email.",
    });
  } catch (error) {
    console.error("[MagicAuth request error]", error);
    return {
      email,
      step: "email",
      error: "Could not send the code. Please try again.",
    };
  }
}

export async function verifyMagicCode(
  previousState: EmailCodeActionState,
  formData: FormData,
): Promise<EmailCodeActionState> {
  const requestHeaders = await headers();
  const email =
    normalizeEmail(formData.get("email")) || normalizeEmail(previousState.email);
  const code = normalizeCode(formData.get("code"));

  if (!isValidEmail(email)) {
    return {
      email,
      step: "email",
      error: "Enter a valid email address.",
    };
  }

  if (!code) {
    return buildCodeStepState(email, {
      error: "Enter the one-time code from your email.",
    });
  }

  let requestOrigin: string;

  try {
    const authResponse =
      await getWorkOS().userManagement.authenticateWithMagicAuth({
        clientId: process.env.WORKOS_CLIENT_ID!,
        code,
        email,
        ipAddress: getClientIp(requestHeaders),
        userAgent: requestHeaders.get("user-agent") || undefined,
      });

    if (!isAllowedWorkosOrganization(authResponse.organizationId)) {
      console.warn("[MagicAuth verify denied] Organization is not allowed.", {
        email,
        organizationId: authResponse.organizationId ?? null,
      });

      return buildCodeStepState(email, {
        error: "This account is not allowed to sign in to this workspace.",
      });
    }

    requestOrigin = await getRequestOrigin();

    await saveSession(
      authResponse,
      new URL("/api/auth/callback", requestOrigin).toString(),
    );
  } catch (error) {
    console.error("[MagicAuth verify error]", error);
    return buildCodeStepState(email, {
      error: "Invalid or expired code. Request a new one and try again.",
    });
  }

  redirect("/workspace");
}
