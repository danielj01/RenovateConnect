-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyLeads" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyMessages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyAppointments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyReviews" BOOLEAN NOT NULL DEFAULT true;
