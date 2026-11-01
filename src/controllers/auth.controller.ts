import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type {
  AuthServiceContract,
  OAuthServiceContract,
  SessionResult,
} from "../types/contracts.js";
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  readOAuthStateCookie,
  readSessionCookie,
  setOAuthStateCookie,
  setSessionCookie,
} from "../utils/cookies.js";
import { AppError } from "../utils/errors.js";
import { validate } from "../utils/validation.js";
import { loginSchema, oauthCallbackSchema, registerSchema } from "../schemas/auth.schema.js";
import { validateOAuthState } from "../services/oauth.service.js";

const isSecure = env.NODE_ENV === "production";

export function createAuthController(
  authService: AuthServiceContract,
  oauthService: OAuthServiceContract,
): {
  register: RequestHandler;
  login: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
  oauthStart(provider: "google" | "yandex"): RequestHandler;
  oauthCallback(provider: "google" | "yandex"): RequestHandler;
  oauthProviders: RequestHandler;
} {
  return {
    register: async (request, response) => {
      const input = validate(registerSchema, request.body);
      let session: SessionResult;
      try {
        session = await authService.register(input);
      } catch (error) {
        logger.warn(
          { event: "registration_failed", method: "password" },
          "User registration failed",
        );
        throw error;
      }
      setSessionCookie(response, session.token, session.expiresAt, isSecure);
      logger.info({ event: "registration_succeeded", method: "password" }, "User registered");
      response.status(201).json({ user: session.user });
    },
    login: async (request, response) => {
      const input = validate(loginSchema, request.body);
      let session: SessionResult;
      try {
        session = await authService.login(input);
      } catch (error) {
        logger.warn(
          { event: "authentication_failed", method: "password" },
          "User authentication failed",
        );
        throw error;
      }
      setSessionCookie(response, session.token, session.expiresAt, isSecure);
      logger.info({ event: "authentication_succeeded", method: "password" }, "User authenticated");
      response.json({ user: session.user });
    },
    logout: async (request, response) => {
      await authService.logout(readSessionCookie(request.headers.cookie));
      clearSessionCookie(response, isSecure);
      response.status(204).end();
    },
    me: (request, response) => {
      response.json({ user: request.authUser });
    },
    oauthStart: (provider) => (_request, response) => {
      const state = randomBytes(32).toString("base64url");
      const authorizationUrl = oauthService.getAuthorizationUrl(provider, state);
      setOAuthStateCookie(response, provider, state, isSecure);
      response.redirect(302, authorizationUrl);
    },
    oauthProviders: (_request, response) => {
      response.json({
        providers: {
          google: oauthService.isConfigured("google"),
          yandex: oauthService.isConfigured("yandex"),
        },
      });
    },
    oauthCallback: (provider) => async (request, response) => {
      const callback = validate(oauthCallbackSchema, request.query);
      const cookieState = readOAuthStateCookie(request.headers.cookie, provider);
      clearOAuthStateCookie(response, provider, isSecure);

      if (!validateOAuthState(callback.state, cookieState)) {
        logger.warn({ provider, event: "oauth_state_invalid" }, "OAuth state validation failed");
        throw new AppError(400, "OAUTH_STATE_INVALID", "OAuth state validation failed.");
      }
      if (callback.error) {
        logger.warn(
          { provider, event: "oauth_provider_rejected" },
          "OAuth provider rejected sign-in",
        );
        const destination = new URL(env.FRONTEND_URL);
        destination.searchParams.set("oauthError", "OAUTH_REJECTED");
        response.redirect(302, destination.toString());
        return;
      }
      if (!callback.code) {
        throw new AppError(
          400,
          "OAUTH_CODE_MISSING",
          "The identity provider did not return an authorization code.",
        );
      }

      const session = await oauthService.authenticate(provider, callback.code);
      setSessionCookie(response, session.token, session.expiresAt, isSecure);
      logger.info({ provider, event: "authentication_succeeded" }, "OAuth user authenticated");
      response.redirect(302, env.FRONTEND_URL);
    },
  };
}
