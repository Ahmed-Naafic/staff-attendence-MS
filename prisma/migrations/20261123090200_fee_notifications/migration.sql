-- Fee Management notifications (overdue fees, generation failures). Alone: a new enum value.
ALTER TYPE "NotificationCategory" ADD VALUE 'FEES';
