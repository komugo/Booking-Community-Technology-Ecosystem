CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_no_overlap" EXCLUDE USING gist ("resource_id" WITH =, "block" WITH &&);
