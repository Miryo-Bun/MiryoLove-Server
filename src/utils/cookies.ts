import { parse, serialize } from "cookie";
import type { SerializeOptions } from "cookie";
import type { Response } from "express";

const sessionCookieName = "miryolove_session";
const oauthStateLifetimeSeconds = 600;

function baseCookieOptions(secure: boolean): SerializeOptions {
  return { httpOnly: true, secure, sameSite: "lax", path: "/api" };
}

export function readSessionCookie(header: string | undefined): string | undefined {
  return header ? parse(header)[sessionCookieName] : undefined;
}

export function setSessionCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  response.appendHeader(
    "Set-Cookie",
    serialize(sessionCookieName, token, {
      ...baseCookieOptions(secure),
      expires: expiresAt,
    }),
  );
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.appendHeader(
    "Set-Cookie",
    serialize(sessionCookieName, "", {
      ...baseCookieOptions(secure),
      expires: new Date(0),
      maxAge: 0,
    }),
  );
}

export function setOAuthStateCookie(
  response: Response,
  provider: "google" | "yandex",
  state: string,
  secure: boolean,
): void {
  response.appendHeader(
    "Set-Cookie",
    serialize(`miryolove_oauth_${provider}`, state, {
      ...baseCookieOptions(secure),
      maxAge: oauthStateLifetimeSeconds,
      path: `/api/auth/${provider}`,
    }),
  );
}

export function readOAuthStateCookie(
  header: string | undefined,
  provider: "google" | "yandex",
): string | undefined {
  return header ? parse(header)[`miryolove_oauth_${provider}`] : undefined;
}

export function clearOAuthStateCookie(
  response: Response,
  provider: "google" | "yandex",
  secure: boolean,
): void {
  response.appendHeader(
    "Set-Cookie",
    serialize(`miryolove_oauth_${provider}`, "", {
      ...baseCookieOptions(secure),
      maxAge: 0,
      expires: new Date(0),
      path: `/api/auth/${provider}`,
    }),
  );
}

export function getCookiePolicy(secure: boolean, sessionLifetimeDays: number) {
  return {
    session: {
      name: sessionCookieName,
      purpose: "Keeps the user signed in to MiryoLove AI.",
      contents: "opaque_session_token",
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api",
      domain: null,
      maxAgeDays: sessionLifetimeDays,
    },
    oauthState: {
      names: ["miryolove_oauth_google", "miryolove_oauth_yandex"],
      purpose: "Temporarily protects Google and Yandex sign-in against request forgery.",
      contents: "oauth_state_value",
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/auth/{provider}",
      domain: null,
      maxAgeSeconds: oauthStateLifetimeSeconds,
    },
    analytics: false,
    advertising: false,
  } as const;
}
