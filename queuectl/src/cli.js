#!/usr/bin/env node
import { getDB, getConfig, setConfig } from './db.js';
import { enqueue, listJobs, counts, listDLQ, retryFromDLQ } from './repo.js';
import { spawn } from 'child_process';
import path from 'path';
import url from 'url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const cmd = args[0];

function arg(key) {
  const i = args.indexOf(key);
  return i !== -1 ? args[i + 1] : null;
}

const dbPath = arg('--db') || path.resolve(process.cwd(), 'queue.db');

async function main() {
  const db = await getDB(dbPath);

  if (cmd === 'enqueue') {
    const payload = args[1];
    if (!payload) {
      console.error("Usage: queuectl enqueue '{\"id\":\"job1\",\"command\":\"sleep 2\"}'");
      process.exit(1);
    }
    await enqueue(db, JSON.parse(payload));
    console.log('Enqueued job.');
    return;
  }

  if (cmd === 'worker') {
    const action = args[1];

    if (action === 'start') {
      const count = Number(arg('--count') || 1);

      for (let i = 0; i < count; i++) {

        const p = spawn(
            process.execPath,
            [path.join(__dirname, 'worker.js'), '--db', dbPath],
            { detached: true, stdio: 'ignore', windowsHide: true }
        );

        p.unref();
        console.log('Started worker PID:', p.pid);
      }

      return;
    }

    if (action === 'stop') {
      const workers = await db.all(`SELECT pid FROM workers`);
      workers.forEach(w => {
        try { process.kill(w.pid, 'SIGTERM'); } catch {}
      });
      console.log(`Stop signal sent to ${workers.length} workers.`);
      return;
    }
  }

  if (cmd === 'status') {
    const c = await counts(db);
    console.table(c);
    const ws = await db.all(`SELECT * FROM workers`);
    console.log('Workers:');
    ws.forEach(w => console.log(w));
    return;
  }

  if (cmd === 'list') {
    const state = arg('--state');
    console.table(await listJobs(db, state));
    return;
  }

  if (cmd === 'dlq') {
    const action = args[1];
    if (action === 'list') {
      console.table(await listDLQ(db));
      return;
    }
    if (action === 'retry') {
      const id = args[2];
      await retryFromDLQ(db, id);
      console.log('DLQ job retried.');
      return;
    }
  }

  if (cmd === 'config') {
    const action = args[1];
    const key = args[2];

    if (action === 'get') {
      console.log(key, '=', await getConfig(db, key));
      return;
    }
    if (action === 'set') {
      const value = args[3];
      await setConfig(db, key, value);
      console.log('Config updated.');
      return;
    }
  }

  console.log(`
queuectl commands:

  queuectl enqueue '{"id":"job1","command":"sleep 2"}'
  queuectl worker start --count 3
  queuectl worker stop
  queuectl status
  queuectl list --state pending
  queuectl dlq list
  queuectl dlq retry <id>
  queuectl config get backoff_base
  queuectl config set max_retries 3
`);
}

main();
