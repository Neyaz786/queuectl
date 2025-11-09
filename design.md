# Design

## Architecture Overview

queuectl follows a simple layered architecture with clear separation of concerns:

```
┌─────────────┐
│   CLI       │  (cli.js) - Command interface
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Repository │  (repo.js) - Data access layer
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Database   │  (db.js) - SQLite storage
└─────────────┘

┌─────────────┐
│   Worker    │  (worker.js) - Background job executor
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Repository │  (repo.js)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Database   │  (db.js)
└─────────────┘
```

## Components

### 1. CLI (`src/cli.js`)
- Entry point for all user commands
- Parses command-line arguments
- Routes commands to appropriate repository functions
- Spawns worker processes as detached child processes
- Handles: `enqueue`, `worker start/stop`, `status`, `list`, `dlq`, `config`

### 2. Database (`src/db.js`)
- Manages SQLite database connection and initialization
- Creates schema: `jobs`, `dlq`, `workers`, `config` tables
- Enables WAL mode for concurrent access
- Provides configuration getter/setter functions

### 3. Repository (`src/repo.js`)
- Data access layer for all database operations
- Job management: `enqueue`, `listJobs`, `counts`
- Job execution: `fetchAndLockNext`, `completeJob`, `failJob`
- DLQ operations: `markDead`, `listDLQ`, `retryFromDLQ`
- Worker tracking: `heartbeat`, `removeWorker`

### 4. Worker (`src/worker.js`)
- Background process that continuously polls for jobs
- Atomically claims jobs using transactions
- Executes commands via `child_process.exec`
- Handles retries with exponential backoff
- Supports graceful shutdown (finishes current job before exit)

## Data Flow

### Job Lifecycle

1. **Enqueue**: CLI → Repository → Database (insert into `jobs` table)
2. **Claim**: Worker → Repository → Database (atomic transaction to lock job)
3. **Execute**: Worker executes command via shell
4. **Complete/Fail**: Worker → Repository → Database (update state)
5. **Retry**: On failure, job is requeued with exponential backoff
6. **DLQ**: After max retries, job moved to `dlq` table

### Concurrency Model

- **Atomic Job Claiming**: Uses `BEGIN IMMEDIATE TRANSACTION` to prevent race conditions
- **Multiple Workers**: Each worker runs as separate process, polls independently
- **WAL Mode**: SQLite Write-Ahead Logging enables concurrent reads/writes
- **Locking**: Jobs are locked by worker PID during processing

## Database Schema

- **jobs**: Stores all active jobs with state, attempts, retry config
- **dlq**: Dead Letter Queue for failed jobs after max retries
- **workers**: Tracks active worker processes (PID, heartbeat)
- **config**: Key-value store for `max_retries`, `backoff_base`

## Key Design Decisions

- **SQLite**: Lightweight, file-based, no external dependencies
- **Process-based Workers**: Each worker is a separate Node.js process
- **Exponential Backoff**: `delay = base^attempts` seconds
- **Graceful Shutdown**: Workers finish current job before exiting
- **Minimal Dependencies**: Only `sqlite` and `sqlite3` packages

