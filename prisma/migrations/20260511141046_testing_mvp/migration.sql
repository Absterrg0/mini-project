/*
  Warnings:

  - Added the required column `checks` to the `IngestionCheckpoint` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "IngestionCheckpoint" ADD COLUMN     "checks" JSONB NOT NULL;
