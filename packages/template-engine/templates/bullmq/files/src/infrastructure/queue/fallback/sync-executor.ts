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
 * Runs the handler synchronously in the current process and returns a
 * BullMQ-shaped Job stub. Throws if the handler throws — same semantics as
 * BullMQ.Worker would surface via the `failed` event, but inline.
 */
export async function executeSync<TData, TResult>(
  jobName: string,
  data: TData,
  handler: (data: TData) => Promise<TResult>,
): Promise<SyncJob<TData, TResult>> {
  const id = nextId();
  const timestamp = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[bullmq:fallback] executing ${jobName} (${id}) inline`);
  const returnvalue = await handler(data);
  return {
    id,
    name: jobName,
    data,
    returnvalue,
    timestamp,
    finishedOn: Date.now(),
  };
}
