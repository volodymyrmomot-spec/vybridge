/*
  Warnings:

  - Added the required column `click_url` to the `creatives` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "click_url" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "clicks" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "creative_id" TEXT,
    "ip" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clicks_deal_id_ip_created_at_idx" ON "clicks"("deal_id", "ip", "created_at");

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_creative_id_fkey" FOREIGN KEY ("creative_id") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;
