export class CoordinatorOrderRequestTimeout extends Error {}
export class CoordinatorOrderHttpError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function withCoordinatorOrderDeadline<T>(operation: () => Promise<T>, milliseconds: number, message: string, cancel?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new CoordinatorOrderRequestTimeout(message)); cancel?.(); }, milliseconds);
    });
    return await Promise.race([operation(), expired]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function coordinatorOrderRequest<T>(url: string, init: RequestInit = {}, milliseconds = 45_000, mayWrite = Boolean(init.method && init.method !== "GET")): Promise<T> {
  const controller = new AbortController();
  const parent = init.signal;
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  try {
    return await withCoordinatorOrderDeadline(async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let data: { message?: string };
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`Purchase Orders returned an incomplete response (HTTP ${response.status}). Refresh the saved orders before retrying.`); }
      if (!response.ok) throw new CoordinatorOrderHttpError(data.message || `Purchase Order request failed (HTTP ${response.status}).`, response.status);
      return data as T;
    }, milliseconds, mayWrite
      ? "This request took too long. It may have completed. Refresh saved orders before trying again; do not create or send a duplicate."
      : "Loading or checking Purchase Orders took too long. Please retry; a preview does not create or send an order.", abort);
  } finally { parent?.removeEventListener("abort", abort); }
}
