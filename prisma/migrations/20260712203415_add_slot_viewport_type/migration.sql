-- CreateEnum
CREATE TYPE "ViewportType" AS ENUM ('desktop', 'mobile');

-- AlterTable
ALTER TABLE "slots" ADD COLUMN     "capture_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "picker_viewport_height" INTEGER NOT NULL DEFAULT 900,
ADD COLUMN     "picker_viewport_width" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN     "viewport_type" "ViewportType" NOT NULL DEFAULT 'desktop';
