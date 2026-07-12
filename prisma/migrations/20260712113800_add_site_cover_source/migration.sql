-- CreateEnum
CREATE TYPE "CoverSource" AS ENUM ('placeholder', 'manual', 'automatic', 'ai', 'system');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "cover_source" "CoverSource" NOT NULL DEFAULT 'placeholder';
