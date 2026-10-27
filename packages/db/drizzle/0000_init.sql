CREATE TYPE "public"."resource_kind" AS ENUM('horse', 'instructor', 'belayer', 'auto_belay_lane');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('issued', 'cancelled', 'forfeited');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"slug_en" text NOT NULL,
	"slug_ms" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ms" text NOT NULL,
	"description_en" text NOT NULL,
	"description_ms" text NOT NULL,
	"free_cancel_hours" integer NOT NULL,
	CONSTRAINT "activities_slugEn_unique" UNIQUE("slug_en"),
	CONSTRAINT "activities_slugMs_unique" UNIQUE("slug_ms"),
	CONSTRAINT "activities_free_cancel_hours" CHECK ("activities"."free_cancel_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"hold_id" uuid,
	"ticket_id" uuid,
	"participant_id" uuid NOT NULL,
	"block" "tstzrange" NOT NULL,
	CONSTRAINT "allocations_hold_or_ticket" CHECK (num_nonnulls("allocations"."hold_id", "allocations"."ticket_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_holdId_unique" UNIQUE("hold_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_en" text NOT NULL,
	"slug_ms" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ms" text NOT NULL,
	CONSTRAINT "categories_slugEn_unique" UNIQUE("slug_en"),
	CONSTRAINT "categories_slugMs_unique" UNIQUE("slug_ms")
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_en" text NOT NULL,
	"slug_ms" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ms" text NOT NULL,
	CONSTRAINT "cities_slugEn_unique" UNIQUE("slug_en"),
	CONSTRAINT "cities_slugMs_unique" UNIQUE("slug_ms")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	CONSTRAINT "customers_email_unique" UNIQUE("email"),
	CONSTRAINT "customers_phone_unique" UNIQUE("phone"),
	CONSTRAINT "customers_contact" CHECK ("customers"."email" is not null or "customers"."phone" is not null)
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"timeslot_id" uuid NOT NULL,
	"price_sen" integer NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '15 minutes' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_resources" (
	"option_id" uuid NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "option_resources_option_id_kind_pk" PRIMARY KEY("option_id","kind"),
	CONSTRAINT "option_resources_quantity" CHECK ("option_resources"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ms" text NOT NULL,
	"price_sen" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"min_age" integer,
	"max_age" integer,
	"max_weight_kg" integer,
	"required_cert" text,
	CONSTRAINT "options_price_sen" CHECK ("options"."price_sen" >= 0),
	CONSTRAINT "options_duration_minutes" CHECK ("options"."duration_minutes" > 0),
	CONSTRAINT "options_age_range" CHECK ("options"."min_age" <= "options"."max_age")
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"sessions_total" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packs_sessions_total" CHECK ("packs"."sessions_total" > 0)
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_date" date NOT NULL,
	"weight_kg" integer,
	"certs" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"max_sessions_per_day" integer,
	"rest_minutes" integer DEFAULT 0 NOT NULL,
	"max_rider_weight_kg" integer,
	CONSTRAINT "resources_max_sessions_per_day" CHECK ("resources"."max_sessions_per_day" > 0),
	CONSTRAINT "resources_rest_minutes" CHECK ("resources"."rest_minutes" >= 0),
	CONSTRAINT "resources_max_rider_weight_kg" CHECK ("resources"."max_rider_weight_kg" > 0),
	CONSTRAINT "resources_welfare_rules_horse_only" CHECK ("resources"."kind" = 'horse' or ("resources"."max_sessions_per_day" is null and "resources"."rest_minutes" = 0 and "resources"."max_rider_weight_kg" is null))
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid,
	"pack_id" uuid,
	"participant_id" uuid NOT NULL,
	"timeslot_id" uuid NOT NULL,
	"price_sen" integer NOT NULL,
	"status" "ticket_status" DEFAULT 'issued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_price_sen" CHECK ("tickets"."price_sen" >= 0),
	CONSTRAINT "tickets_booking_or_pack" CHECK (num_nonnulls("tickets"."booking_id", "tickets"."pack_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "timeslots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_timeslot_id_timeslots_id_fk" FOREIGN KEY ("timeslot_id") REFERENCES "public"."timeslots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_resources" ADD CONSTRAINT "option_resources_option_id_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_timeslot_id_timeslots_id_fk" FOREIGN KEY ("timeslot_id") REFERENCES "public"."timeslots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeslots" ADD CONSTRAINT "timeslots_option_id_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_city_id_category_id_index" ON "activities" USING btree ("city_id","category_id");--> statement-breakpoint
CREATE INDEX "allocations_hold_id_index" ON "allocations" USING btree ("hold_id");--> statement-breakpoint
CREATE INDEX "allocations_ticket_id_index" ON "allocations" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "holds_expires_at_index" ON "holds" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "holds_timeslot_id_index" ON "holds" USING btree ("timeslot_id");--> statement-breakpoint
CREATE INDEX "options_activity_id_index" ON "options" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "participants_customer_id_index" ON "participants" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "resources_operator_id_kind_index" ON "resources" USING btree ("operator_id","kind");--> statement-breakpoint
CREATE INDEX "tickets_timeslot_id_index" ON "tickets" USING btree ("timeslot_id");--> statement-breakpoint
CREATE INDEX "tickets_booking_id_index" ON "tickets" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "tickets_pack_id_index" ON "tickets" USING btree ("pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_one_issued_per_participant_timeslot" ON "tickets" USING btree ("participant_id","timeslot_id") WHERE "tickets"."status" = 'issued';--> statement-breakpoint
CREATE UNIQUE INDEX "timeslots_option_id_starts_at_index" ON "timeslots" USING btree ("option_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waivers_participant_id_operator_id_index" ON "waivers" USING btree ("participant_id","operator_id");