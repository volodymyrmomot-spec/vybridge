-- CreateTable
CREATE TABLE "picker_tokens" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "publisher_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picker_tokens_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "picker_tokens" ADD CONSTRAINT "picker_tokens_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
