CREATE INDEX "idx_collections_user_id" ON "collections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collections_contract_chain" ON "collections" USING btree ("user_id","contract_address","chain");--> statement-breakpoint
CREATE INDEX "idx_collections_contract_address" ON "collections" USING btree ("contract_address");