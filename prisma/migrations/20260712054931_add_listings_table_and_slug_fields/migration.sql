-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('website_banner', 'website_popup', 'instagram_post', 'tiktok_video', 'youtube_integration', 'podcast_ad', 'newsletter_ad');

-- CreateEnum
CREATE TYPE "ListingSourceType" AS ENUM ('slot', 'blogger_channel');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('draft', 'active', 'paused', 'archived');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "cover_image_url" TEXT,
ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "slots" ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "listing_type" "ListingType" NOT NULL,
    "source_type" "ListingSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover_image_url" TEXT,
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "status" "ListingStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listings_slug_key" ON "listings"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "listings_source_type_source_id_key" ON "listings"("source_type", "source_id");
