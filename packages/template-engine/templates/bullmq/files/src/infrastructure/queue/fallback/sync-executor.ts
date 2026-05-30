import type { Job } from "bullmq";

// Drop-in stand-in for BullMQ's `Job` shape returned by Queue.add() when the
// queue layer is running in fallback mode. The minimal surface area covers
// the fields most callers read (id, name, data, return value), so consumer
// code that does `const job = await addJob(...); job.id; job.returnvalue;`
// works the same regardless of whether Redis was up.
export interface SyncJob<TData, TResult> {
  readonly id: string;
  readonly name: string;
  readonly data: TData;
  readonly returnvalue: TResult;
  readonly timestamp: number;
  readonly finishedOn: number;
}

let counter = 0;

function nextId(): string {
  counter += 1;
  // Prefixed so consumers can tell sync-executed jobs from real BullMQ ones
  // when logging or storing references.
  return `sync-${Date.now()}-${counter}`;
}

/**
 * Build a Job-shaped object that satisfies the structural minimum BullMQ
 * worker callbacks use — id, name, data, log(), updateProgress(), etc. The
 * type assertion is isolated to this single factory: every other piece of
 * fallback code receives a "real-looking" Job instead of an ad-hoc inline
 * stub, so if a handler later starts using a field we don't proxy here,
 * the failure surfaces in one well-named place rather than as a runtime
 * TypeError deep inside a per-job wrapper.
 */
function makeFallbackJob<TData>(
  id: string,
  name: string,
  data: TData,
  timestamp: number,
): Job<TData> {
  const stub: Partial<Job<TData>> & { progress: number | object } = {
    id,
    name,
    data,
    timestamp,
    attemptsMade: 0,
    progress: 0,
    log: async (row: string): Promise<number> => {
      // eslint-disable-next-line no-console
      console.log(`[bullmq:fallback:${name}:${id}] ${row}`);
      return 0;
    },
    updateProgress: async function (next: number | object): Promise<void> {
      stub.progress = next;
    },
    updateData: async function (next: TData): Promise<void> {
      stub.data = next;
    },
    getState: async (): Promise<"completed"> => "completed",
    isCompleted: async (): Promise<boolean> => true,
    isFailed: async (): Promise<boolean> => false,
    remove: async (): Promise<void> => undefined,
  };
  return stub as unknown as Job<TData>;
}

/**
 * Runs the handler synchronously in the current process and returns a
 * BullMQ-shaped Job stub. The handler receives a fallback Job rather than
 * raw data so its signature stays identical to the BullMQ worker path —
 * no per-handler wrappers, no `as never` casts at the call site.
 */
export async function executeSync<TData, TResult>(
  jobName: string,
  data: TData,
  handler: (job: Job<TData>) => Promise<TResult>,
): Promise<SyncJob<TData, TResult>> {
  const id = nextId();
  const timestamp = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[bullmq:fallback] executing ${jobName} (${id}) inline`);
  const job = makeFallbackJob(id, jobName, data, timestamp);
  const returnvalue = await handler(job);
  return {
    id,
    name: jobName,
    // Read job.data, not the original `data` arg — handlers can call
    // updateData() to evolve the payload, and BullMQ's real Job exposes
    // the mutated value here. Returning the original would silently
    // diverge fallback behaviour from the BullMQ path.
    data: job.data,
    returnvalue,
    timestamp,
    finishedOn: Date.now(),
  };
}
