/*
  Warnings:

  - Added the required column `sourceRunExternalId` to the `OptimizationPlanRecord` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OptimizationPlanRecord" ADD COLUMN     "sourceRunExternalId" TEXT NOT NULL;
