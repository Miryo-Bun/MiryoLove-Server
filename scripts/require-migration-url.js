import { env } from "node:process";
import "dotenv/config";

if (!env.MIGRATION_DATABASE_URL) {
  throw new Error("MIGRATION_DATABASE_URL must be set before running database migrations.");
}
