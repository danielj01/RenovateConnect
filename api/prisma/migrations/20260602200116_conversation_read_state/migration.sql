-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "businessLastReadAt" TIMESTAMP(3),
ADD COLUMN     "clientLastReadAt" TIMESTAMP(3);
