import { getConfig } from './db.js';

export async function enqueue(db, job) {
  const now = new Date().toISOString();
  const maxRetries = Number(job.max_retries ?? await getConfig(db, 'max_retries'));

  await db.run(
    `INSERT INTO jobs(id,command,state,attempts,max_retries,created_at,updated_at,next_run_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    [
      job.id,
      job.command,
      'pending',
      0,
      maxRetries,
      now,
      now,
      now
    ]
  );
}

export async function listJobs(db, state) {
  if (state) return db.all(`SELECT * FROM jobs WHERE state=? ORDER BY created_at`, [state]);
  return db.all(`SELECT * FROM jobs ORDER BY created_at`);
}

export async function counts(db) {
  const rows = await db.all(`SELECT state,COUNT(*) c FROM jobs GROUP BY state`);
  const result = { pending:0, processing:0, completed:0, failed:0, dead:0 };

  rows.forEach(r => result[r.state] = r.c);

  const workers = await db.all(`SELECT * FROM workers`);
  return { ...result, workers: workers.length };
}

export async function markDead(db, job, reason) {
  const now = new Date().toISOString();

  await db.run(
    `INSERT OR REPLACE INTO dlq(id,command,attempts,max_retries,created_at,failed_at,last_error)
     VALUES(?,?,?,?,?,?,?)`,
    [
      job.id,
      job.command,
      job.attempts,
      job.max_retries,
      job.created_at,
      now,
      reason?.slice(0,2000) ?? null
    ]
  );

  await db.run(`DELETE FROM jobs WHERE id=?`, [job.id]);
}

export async function retryFromDLQ(db, id) {
  const row = await db.get(`SELECT * FROM dlq WHERE id=?`, [id]);
  if (!row) throw new Error('DLQ job not found');

  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO jobs(id,command,state,attempts,max_retries,created_at,updated_at,next_run_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    [
      row.id,
      row.command,
      'pending',
      0,
      row.max_retries,
      row.created_at,
      now,
      now
    ]
  );

  await db.run(`DELETE FROM dlq WHERE id=?`, [id]);
}

export async function listDLQ(db) {
  return db.all(`SELECT * FROM dlq ORDER BY failed_at DESC`);
}

export async function heartbeat(db, pid) {
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO workers(pid,started_at,last_heartbeat)
     VALUES(?,?,?)
     ON CONFLICT(pid) DO UPDATE SET last_heartbeat=excluded.last_heartbeat`,
    [pid, now, now]
  );
}

export async function removeWorker(db, pid) {
  await db.run(`DELETE FROM workers WHERE pid=?`, [pid]);
}

export async function fetchAndLockNext(db, pid) {
  const now = new Date().toISOString();

  await db.exec('BEGIN IMMEDIATE TRANSACTION');

  try {
    const job = await db.get(
      `SELECT * FROM jobs
       WHERE state='pending'
         AND next_run_at<=?
         AND (locked_by IS NULL OR locked_by=?)
       ORDER BY created_at
       LIMIT 1`,
      [now, pid]
    );

    if (!job) {
      await db.exec('COMMIT');
      return null;
    }

    const updated = await db.run(
      `UPDATE jobs 
       SET state='processing', locked_by=?, updated_at=?
       WHERE id=? AND state='pending'`,
      [pid, now, job.id]
    );

    await db.exec('COMMIT');

    return updated.changes ? job : null;

  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

export async function completeJob(db, id) {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE jobs SET state='completed',updated_at=?,locked_by=NULL WHERE id=?`,
    [now, id]
  );
}

export async function failJob(db, job, errorMsg) {
  const base = Number(await getConfig(db,'backoff_base'));
  const now = new Date();
  const attempts = job.attempts + 1;

  if (attempts > job.max_retries) {
    await markDead(db, { ...job, attempts }, errorMsg);
    return;
  }

  const delaySec = Math.pow(base, attempts);
  const nextRun = new Date(now.getTime() + delaySec*1000).toISOString();

  await db.run(
    `UPDATE jobs
     SET state='pending', attempts=?, updated_at=?, next_run_at=?, last_error=?, locked_by=NULL
     WHERE id=?`,
    [
      attempts,
      now.toISOString(),
      nextRun,
      String(errorMsg).slice(0,2000),
      job.id
    ]
  );
}
