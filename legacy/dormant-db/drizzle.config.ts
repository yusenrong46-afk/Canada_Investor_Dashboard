import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Reserved for future persistence work. The live app does not currently run migrations.
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/home_value_planner",
  },
});
