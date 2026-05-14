-- CreateEnum
CREATE TYPE "PortfolioItemType" AS ENUM ('CLASS_WORK', 'PROJECT', 'CREATIVE', 'HOMEWORK', 'PRESENTATION', 'OBSERVATION');

-- CreateTable
CREATE TABLE "portfolio_items" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "outcomeId" TEXT,
    "type" "PortfolioItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "occurredOn" DATE NOT NULL,
    "fileUrl" TEXT,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_item_history" (
    "id" UUID NOT NULL,
    "portfolioItemId" UUID NOT NULL,
    "previousDescription" TEXT,
    "newDescription" TEXT NOT NULL,
    "changedById" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_item_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_items_schoolId_idx" ON "portfolio_items"("schoolId");

-- CreateIndex
CREATE INDEX "portfolio_items_studentId_sessionId_idx" ON "portfolio_items"("studentId", "sessionId");

-- CreateIndex
CREATE INDEX "portfolio_items_sessionId_idx" ON "portfolio_items"("sessionId");

-- CreateIndex
CREATE INDEX "portfolio_items_occurredOn_idx" ON "portfolio_items"("occurredOn");

-- CreateIndex
CREATE INDEX "portfolio_item_history_portfolioItemId_idx" ON "portfolio_item_history"("portfolioItemId");

-- CreateIndex
CREATE INDEX "portfolio_item_history_changedAt_idx" ON "portfolio_item_history"("changedAt");

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "learning_outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_item_history" ADD CONSTRAINT "portfolio_item_history_portfolioItemId_fkey" FOREIGN KEY ("portfolioItemId") REFERENCES "portfolio_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_item_history" ADD CONSTRAINT "portfolio_item_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
