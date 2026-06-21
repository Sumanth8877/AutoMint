ALTER TABLE "wallets" ADD COLUMN "wallet_type" text DEFAULT 'UNKNOWN' NOT NULL;

UPDATE "wallets"
SET "wallet_type" = 'EVM'
WHERE "address" ~* '^0x[0-9a-f]{40}$';
