\set ON_ERROR_STOP on
\getenv app_role POSTGRES_APP_USER
\getenv app_password POSTGRES_APP_PASSWORD
\getenv migration_role POSTGRES_MIGRATOR_USER
\getenv migration_password POSTGRES_MIGRATOR_PASSWORD
\getenv bootstrap_role POSTGRES_USER

SELECT CASE
  WHEN :'app_role' <> :'migration_role'
    AND :'app_role' <> :'bootstrap_role'
    AND :'migration_role' <> :'bootstrap_role'
  THEN 'true'
  ELSE 'false'
END AS roles_are_distinct
\gset

\if :roles_are_distinct
\else
\echo 'PostgreSQL bootstrap, runtime, and migration roles must be distinct.'
\quit 3
\endif

SELECT format('CREATE ROLE %I', :'app_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'app_role')
\gexec

SELECT format('CREATE ROLE %I', :'migration_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'migration_role')
\gexec

ALTER ROLE :"app_role" WITH LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE :"migration_role" WITH LOGIN PASSWORD :'migration_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database())
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'migration_role')
\gexec
SELECT format('GRANT CREATE ON DATABASE %I TO %I', current_database(), :'migration_role')
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT USAGE, CREATE ON SCHEMA public TO :"migration_role";
