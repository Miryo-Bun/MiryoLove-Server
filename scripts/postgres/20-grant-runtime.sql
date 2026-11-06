\set ON_ERROR_STOP on
\getenv app_role POSTGRES_APP_USER

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.users,
  public.oauth_accounts,
  public.sessions,
  public.chats,
  public.messages
TO :"app_role";

GRANT USAGE ON TYPE
  public."OAuthProvider",
  public."MessageRole"
TO :"app_role";

REVOKE ALL ON TABLE public._prisma_migrations FROM :"app_role";
