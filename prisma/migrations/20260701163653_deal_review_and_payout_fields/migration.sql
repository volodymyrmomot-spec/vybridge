-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "pending_approval_at" TIMESTAMP(3),
ADD COLUMN     "stripe_refund_id" TEXT;

-- CreateIndex
CREATE INDEX "deals_status_pending_approval_at_idx" ON "deals"("status", "pending_approval_at");

-- CreateIndex
CREATE INDEX "deals_status_ends_at_idx" ON "deals"("status", "ends_at");

-- CreateIndex
CREATE INDEX "deals_status_payout_eligible_at_idx" ON "deals"("status", "payout_eligible_at");
