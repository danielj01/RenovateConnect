-- CreateTable
CREATE TABLE "SharedEstimate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "roomType" TEXT,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedEstimate_code_key" ON "SharedEstimate"("code");
