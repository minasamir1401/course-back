export interface ArchiveEntry { id: string; name: string; data: any }

/** One checked-out connection owns the lock, reads and insert transaction; originals are always retained. */
export async function archiveCloudBatch(
  pool: any,
  compress: (entries: ArchiveEntry[]) => Promise<Buffer>,
  options: { minimum: number; all?: boolean } = { minimum: 50 }
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(761093214) AS locked');
    if (!lock.rows[0]?.locked) { await client.query('ROLLBACK'); return null; }
    // Bound memory and lock duration. Manual bundles also use batches of at most 50.
    const result = await client.query("SELECT id, name, created_at FROM cloud_backups WHERE type NOT IN ('ARCHIVE', 'REALTIME_SYNC') AND NOT EXISTS (SELECT 1 FROM cloud_backups a WHERE a.type = 'ARCHIVE' AND a.data->'sourceIds' ? cloud_backups.id::text) ORDER BY created_at ASC, id ASC" + (options.all ? "" : " LIMIT 50") + " FOR UPDATE");
    const rows = result.rows;
    if (rows.length < options.minimum) { await client.query('ROLLBACK'); return null; }
    const entries: ArchiveEntry[] = [];
    for (const row of rows) {
      const record = await client.query('SELECT data FROM cloud_backups WHERE id = $1', [row.id]);
      if (record.rows.length !== 1 || record.rows[0].data == null) throw new Error(`Missing archive source ${row.id}`);
      entries.push({ id: row.id, name: row.name, data: record.rows[0].data });
    }
    if (entries.length !== rows.length) throw new Error('Archive source count mismatch');
    const zip = await compress(entries);
    if (!zip.length) throw new Error('Empty archive');
    const archiveName = `archive-${new Date().toISOString()}-${rows.length}`;
    const archiveData = { isArchive: true, compression: 'zip', fileBase64: zip.toString('base64'), count: entries.length, sourceIds: entries.map(entry => entry.id) };
    const inserted = await client.query('INSERT INTO cloud_backups (name, type, data) VALUES ($1, $2, $3) RETURNING id', [archiveName, 'ARCHIVE', JSON.stringify(archiveData)]);
    if (inserted.rowCount !== 1) throw new Error('Archive insert count mismatch');

    await client.query('COMMIT');
    return { success: true, archiveName, count: entries.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

