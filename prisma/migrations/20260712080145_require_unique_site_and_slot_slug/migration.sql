-- AlterTable
ALTER TABLE "sites" ALTER COLUMN "slug" SET NOT NULL;

-- AlterTable
ALTER TABLE "slots" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "sites_slug_key" ON "sites"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "slots_slug_key" ON "slots"("slug");
