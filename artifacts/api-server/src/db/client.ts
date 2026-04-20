// Dormant persistence helper.
// The live Vancouver product does not currently persist plans to Postgres.
// Keep this file only if database-backed plan saving is the next feature.

import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

export function getDb() {
  if (!connectionString) {
    return null;
  }

  const pool = new Pool({ connectionString });
  return drizzle(pool);
}
