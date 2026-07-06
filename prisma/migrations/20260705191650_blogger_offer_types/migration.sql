/*
  Warnings:

  - You are about to drop the column `brief_text` on the `creatives` table. All the data in the column will be lost.
  - You are about to drop the column `content_type` on the `creatives` table. All the data in the column will be lost.
  - Made the column `file_url` on table `creatives` required. This step will fail if there are existing NULL values in that column.
  - Made the column `width` on table `creatives` required. This step will fail if there are existing NULL values in that column.
  - Made the column `height` on table `creatives` required. This step will fail if there are existing NULL values in that column.
  - Made the column `mime_type` on table `creatives` required. This step will fail if there are existing NULL values in that column.
  - Made the column `file_size_bytes` on table `creatives` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('product', 'website', 'other');

-- CreateEnum
CREATE TYPE "AdFormat" AS ENUM ('reels', 'stories', 'post');

-- AlterTable
ALTER TABLE "creatives" DROP COLUMN "brief_text",
DROP COLUMN "content_type",
ALTER COLUMN "file_url" SET NOT NULL,
ALTER COLUMN "width" SET NOT NULL,
ALTER COLUMN "height" SET NOT NULL,
ALTER COLUMN "mime_type" SET NOT NULL,
ALTER COLUMN "file_size_bytes" SET NOT NULL;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "ad_format" "AdFormat",
ADD COLUMN     "click_url" TEXT,
ADD COLUMN     "content_description" TEXT,
ADD COLUMN     "delivery_instructions" TEXT,
ADD COLUMN     "offer_type" "OfferType",
ADD COLUMN     "product_image_url" TEXT,
ADD COLUMN     "product_name" TEXT,
ADD COLUMN     "send_physical_product" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website_url" TEXT;

-- DropEnum
DROP TYPE "ContentType";
