import { getDB } from './db.js';
import { fetchAndLockNext, completeJob, failJob, heartbeat, removeWorker } from './repo.js';
import { exec } from 'child_process';
import util from 'util';

const pexec = util.promisify(exec);
const sleep = ms => new Promise(res => setTimeout(res, ms));

const dbPathArgIndex = process.argv.indexOf('--db');
const dbPath = dbPathArgIndex !== -1 ? process.argv[dbPathArgIndex+1] : null;

let running = true;
let working = false;

process.on('SIGINT', () => running = false);
process.on('SIGTERM', () => running = false);

async function run() {
  const db = await getDB(dbPath);
  const pid = process.pid;

  await heartbeat(db, pid);

  while (running) {
    await heartbeat(db, pid);

    if (!working) {
      const job = await fetchAndLockNext(db, pid);
      if (job) {
        working = true;
        try {
          await pexec(job.command, { shell: true });
          await completeJob(db, job.id);
        } catch (err) {
          await failJob(db, job, err.stderr || err.message);
        }
        working = false;
        continue;
      }
    }

    await sleep(500);
  }

  while (working) await sleep(200);
  await removeWorker(db, pid);
  process.exit(0);
}

run();
