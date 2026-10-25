CREATE TABLE "__framework_auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "__framework_auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "__framework_auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" bigint,
	"refresh_token_expires_at" bigint,
	"scope" text,
	"password" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "__framework_auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" bigint NOT NULL,
	"token" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "__framework_auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "__framework_auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "__framework_auth_rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "__framework_auth_rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "__framework_auth_account" ADD CONSTRAINT "__framework_auth_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."__framework_auth_user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "__framework_auth_session" ADD CONSTRAINT "__framework_auth_session_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."__framework_auth_user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "__framework_auth_account_user_id_idx" ON "__framework_auth_account" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "__framework_auth_session_user_id_idx" ON "__framework_auth_session" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "__framework_auth_verification_identifier_idx" ON "__framework_auth_verification" USING btree ("identifier");
