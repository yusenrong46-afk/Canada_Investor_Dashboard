// Dormant persistence schema.
// This table shape comes from an older planner prototype and is not used by the
// current React -> Express -> Python runtime. Update or remove it before wiring
// Postgres into the live product.

import { boolean, integer, numeric, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const savedPlans = pgTable("saved_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: varchar("label", { length: 160 }).notNull(),
  neighborhoodId: varchar("neighborhood_id", { length: 64 }).notNull(),
  propertyType: varchar("property_type", { length: 32 }).notNull(),
  livingAreaSqft: integer("living_area_sqft").notNull(),
  lotSizeSqft: integer("lot_size_sqft").notNull(),
  bedrooms: integer("bedrooms").notNull(),
  bathrooms: numeric("bathrooms", { precision: 4, scale: 1 }).notNull(),
  ageYears: integer("age_years").notNull(),
  conditionScore: numeric("condition_score", { precision: 3, scale: 1 }).notNull(),
  walkScore: integer("walk_score").notNull(),
  transitScore: integer("transit_score").notNull(),
  schoolScore: integer("school_score").notNull(),
  targetPrice: integer("target_price"),
  budget: integer("budget"),
  months: integer("months"),
  hasKitchenUpgrade: boolean("has_kitchen_upgrade").default(false).notNull(),
  hasBathroomUpgrade: boolean("has_bathroom_upgrade").default(false).notNull(),
  hasLegalSuite: boolean("has_legal_suite").default(false).notNull(),
  hasDeferredMaintenance: boolean("has_deferred_maintenance").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
