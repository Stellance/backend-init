CREATE TYPE "public"."one_time_token_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"user_id" uuid NOT NULL,
	"purpose" "one_time_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_tokens_user_id_purpose_pk" PRIMARY KEY("user_id","purpose"),
	CONSTRAINT "one_time_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "verified_emails" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_emails" ADD CONSTRAINT "verified_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "one_time_tokens_expires_idx" ON "one_time_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "used_refresh_tokens_used_at_idx" ON "used_refresh_tokens" USING btree ("used_at");