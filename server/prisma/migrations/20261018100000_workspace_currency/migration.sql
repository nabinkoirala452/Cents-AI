ALTER TABLE "Workspace"
ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD';

ALTER TABLE "Workspace"
ALTER COLUMN "currency" DROP DEFAULT;

ALTER TABLE "WorkspaceSettings"
DROP COLUMN "usdRate";

ALTER TABLE "PaymentEvent"
DROP COLUMN "fxRate",
DROP COLUMN "amountINR";

ALTER TABLE "Approval"
DROP COLUMN "amountINR";

UPDATE "Client" SET "currency" = 'USD';
UPDATE "Invoice" SET "currency" = 'USD';
UPDATE "PaymentEvent" SET "currency" = 'USD';
UPDATE "Approval" SET "currency" = 'USD';

CREATE TYPE "Currency_new" AS ENUM ('USD');

ALTER TABLE "Workspace"
ALTER COLUMN "currency" TYPE "Currency_new" USING ("currency"::text::"Currency_new");
ALTER TABLE "Client"
ALTER COLUMN "currency" TYPE "Currency_new" USING ("currency"::text::"Currency_new");
ALTER TABLE "Invoice"
ALTER COLUMN "currency" TYPE "Currency_new" USING ("currency"::text::"Currency_new");
ALTER TABLE "PaymentEvent"
ALTER COLUMN "currency" TYPE "Currency_new" USING ("currency"::text::"Currency_new");
ALTER TABLE "Approval"
ALTER COLUMN "currency" TYPE "Currency_new" USING ("currency"::text::"Currency_new");

DROP TYPE "Currency";
ALTER TYPE "Currency_new" RENAME TO "Currency";

ALTER TABLE "Workspace"
ALTER COLUMN "currency" SET DEFAULT 'USD';

ALTER TABLE "Workspace"
ALTER COLUMN "timezone" SET DEFAULT 'America/Chicago';
