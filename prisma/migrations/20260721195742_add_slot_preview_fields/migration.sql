-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('pending', 'ready', 'failed');

-- AlterTable
ALTER TABLE "slots" ADD COLUMN     "page_url" TEXT,
ADD COLUMN     "preview_image_public_id" TEXT,
ADD COLUMN     "preview_image_url" TEXT,
ADD COLUMN     "preview_status" "PreviewStatus" NOT NULL DEFAULT 'pending';
