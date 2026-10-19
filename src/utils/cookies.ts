import { parse, serialize } from "cookie";
import type { SerializeOptions } from "cookie";
import type { Response } from "express";

const sessionCookieName = "miryolove_session";

// Shared parent domain for all MiryoLove services, e.g. ".miryolove.org".
// Empty on localhost, so the cookie stays host-only in development.
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

function baseCookieOptions(secure: boolean): SerializeOptions {
  const options: SerializeOptions = { httpOnly: true, secure, sameSite: "lax", path: "/" };
  if (cookieDomain) {
    options.domain = cookieDomain;
  }
  return options;
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
      maxAge: 600,
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
