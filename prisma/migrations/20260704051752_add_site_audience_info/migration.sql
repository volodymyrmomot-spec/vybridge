-- CreateEnum
CREATE TYPE "SiteCategory" AS ENUM ('technology', 'lifestyle', 'automotive', 'fashion', 'food', 'travel', 'sports', 'business', 'entertainment', 'education', 'health', 'news', 'other');

-- CreateEnum
CREATE TYPE "MonthlyVisitors" AS ENUM ('under_1k', '1k_10k', '10k_50k', '50k_200k', '200k_plus');

-- CreateEnum
CREATE TYPE "AudienceLanguage" AS ENUM ('english', 'slovak', 'ukrainian', 'russian', 'other');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "audience_country" TEXT,
ADD COLUMN     "audience_language" "AudienceLanguage",
ADD COLUMN     "category" "SiteCategory",
ADD COLUMN     "monthly_visitors" "MonthlyVisitors",
ADD COLUMN     "site_description" TEXT;
