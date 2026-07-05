-- CreateEnum
CREATE TYPE "ChannelPlatform" AS ENUM ('instagram', 'tiktok', 'youtube');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('ready_file', 'brief');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DealStatus" ADD VALUE 'pending_blogger_approval';
ALTER TYPE "DealStatus" ADD VALUE 'blogger_accepted';
ALTER TYPE "DealStatus" ADD VALUE 'blogger_published';
ALTER TYPE "DealStatus" ADD VALUE 'blogger_declined';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'blogger';

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_slot_id_fkey";

-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "brief_text" TEXT,
ADD COLUMN     "content_type" "ContentType",
ALTER COLUMN "file_url" DROP NOT NULL,
ALTER COLUMN "width" DROP NOT NULL,
ALTER COLUMN "height" DROP NOT NULL,
ALTER COLUMN "mime_type" DROP NOT NULL,
ALTER COLUMN "file_size_bytes" DROP NOT NULL;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "blogger_channel_id" TEXT,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_url" TEXT,
ALTER COLUMN "slot_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "blogger_channels" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "ChannelPlatform" NOT NULL,
    "channel_url" TEXT NOT NULL,
    "channel_handle" TEXT,
    "followers_count" INTEGER NOT NULL DEFAULT 0,
    "content_category" "SiteCategory",
    "price_per_post_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blogger_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blogger_channels_user_id_idx" ON "blogger_channels"("user_id");

-- CreateIndex
CREATE INDEX "deals_blogger_channel_id_idx" ON "deals"("blogger_channel_id");

-- CreateIndex
CREATE INDEX "deals_status_published_at_idx" ON "deals"("status", "published_at");

-- AddForeignKey
ALTER TABLE "blogger_channels" ADD CONSTRAINT "blogger_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_blogger_channel_id_fkey" FOREIGN KEY ("blogger_channel_id") REFERENCES "blogger_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
