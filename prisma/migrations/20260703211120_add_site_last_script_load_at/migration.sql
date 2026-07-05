-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "last_script_load_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sites_domain_idx" ON "sites"("domain");
