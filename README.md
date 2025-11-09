
# queuectl

---

**Working CLI Demo Video** [Link](https://drive.google.com/file/d/1c-bpbiR9xW646yAHVzxblyFP787OpZS0/view?usp=sharing)

--- 
A minimal CLI-based background job queue for Node.js with retries, exponential backoff, a Dead Letter Queue (DLQ), persistent storage with SQLite, multiple workers, and graceful shutdown.

## Features

- Enqueue text commands to be executed by workers
- Workers run in parallel and pick jobs atomically
- Automatic retries with exponential backoff (`delay = base^attempts`)
- Moves jobs to DLQ after exceeding `max_retries`
- Persistent storage across restarts (SQLite, WAL mode)
- Graceful shutdown (workers finish current job before exit)
- Configurable `max_retries` and `backoff_base`
- Simple CLI

## Install

```bash
cd queuectl
npm install
npm link
```

This makes the `queuectl` command available on your PATH.

## Usage

```bash
# Enqueue
queuectl enqueue '{"id":"job1","command":"echo Hello"}'

# Start 3 workers
queuectl worker start --count 3

# Show status
queuectl status

# List jobs (optionally by state)
queuectl list
queuectl list --state pending

# Stop workers gracefully
queuectl worker stop

# DLQ
queuectl dlq list
queuectl dlq retry job1

# Config
queuectl config get backoff_base
queuectl config set backoff_base 3
queuectl config set max_retries 5
```

### Job States

- `pending` – waiting to be picked by a worker
- `processing` – currently being executed
- `completed` – finished successfully
- `failed` – transitional state, immediately requeued with backoff (not persisted as a stable state)
- `dead` – moved to DLQ after exceeding retries

A job has the following shape:

```json
{
  "id": "unique-job-id",
  "command": "echo 'Hello World'",
  "state": "pending",
  "attempts": 0,
  "max_retries": 3,
  "created_at": "2025-11-04T10:30:00Z",
  "updated_at": "2025-11-04T10:30:00Z"
}
```

## Architecture Overview

- **Storage**: SQLite file `queue.db` with WAL mode for concurrency. Tables: `jobs`, `dlq`, `workers`, `config`.
- **Claiming jobs**: Workers call `fetchAndLockNext` inside a `BEGIN IMMEDIATE` transaction to select one due `pending` job and atomically mark it `processing` with `locked_by=pid`.
- **Execution**: The worker executes `command` via `child_process.exec` using the shell.
- **Retry & Backoff**: On non-zero exit or error, increment `attempts` and set `next_run_at = now + base^attempts`. When `attempts > max_retries`, move to `dlq`.
- **Graceful shutdown**: Workers handle `SIGINT`/`SIGTERM`, finish the running job, remove themselves from the `workers` table, and exit.
- **Configuration**: Stored in `config` table. Keys: `max_retries`, `backoff_base`.

## Testing Scenarios

1. **Basic job succeeds**
   ```bash
   queuectl enqueue '{"id":"ok1","command":"node -e \"process.exit(0)\""}'
   queuectl worker start --count 1
   sleep 1
   queuectl status
   ```
2. **Failed job retries then DLQ**
   ```bash
   queuectl enqueue '{"id":"bad1","command":"bash -lc \"exit 1\"","max_retries":2}'
   queuectl config set backoff_base 1
   queuectl worker start --count 1
   sleep 3
   queuectl dlq list
   ```
3. **Multiple workers without overlap**
   ```bash
   for i in $(seq 1 5); do queuectl enqueue "{\"id\":\"j$i\",\"command\":\"sleep 1\"}"; done
   queuectl worker start --count 3
   ```
4. **Invalid command fails gracefully**
   ```bash
   queuectl enqueue '{"id":"nope","command":"__not_a_cmd__"}'
   ```
5. **Persistence across restart**
   - Start workers, enqueue jobs, stop workers, start again; jobs and DLQ persist because of SQLite.

## Assumptions & Trade-offs

- Uses system shell to execute commands; trust only controlled inputs.
- Uses SQLite (portable, no external service). For high throughput, a server DB and visibility timeouts would be preferred.
- Minimal CLI without external parser dependencies for zero-friction install.
- Worker crash mid-job leaves state `processing`; those jobs can be recovered by adding a timeout monitor if needed.

## Development

```bash
npm run lint   # none provided; optional
```

## Uninstall

```bash
npm unlink -g queuectl
```

## Running the automated tests

### Windows (PowerShell)
Run:
    powershell -ExecutionPolicy Bypass -File test.ps1

### Linux / Mac
Run:
    ./test.sh


