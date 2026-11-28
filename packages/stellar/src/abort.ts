/**
 * Race a promise against an AbortSignal. Rejects promptly with an AbortError
 * (same shape as the pipeline's gate-boundary abort) when the signal fires.
 *
 * This does NOT cancel the underlying operation — the SDK calls we wrap have no
 * native signal support — but it ensures callers never wait on a hung network
 * call past cancellation. The in-flight call may still settle later; callers
 * must not treat a settled value after abort as success.
 */
export function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export function abortError(message = "Execution was cancelled"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}
