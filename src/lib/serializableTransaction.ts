import { Prisma } from '@prisma/client';

// PostgreSQL may abort one concurrent serializable writer even when both hold
// advisory locks. Re-run the whole transaction so duplicate detection sees the
// committed row; never retry only the final write.
export async function serializableTransaction<T>(db: any, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { timeout: 60000, isolationLevel: 'Serializable' });
    } catch (error: any) {
      if (error?.code !== 'P2034' || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}
