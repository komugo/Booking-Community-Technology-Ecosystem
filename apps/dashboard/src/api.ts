import { useCallback, useEffect, useState } from "react";
import { navigate } from "wouter/use-browser-location";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly field?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(code);
  }
}

export async function api<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/ops${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.status === 401 && location.pathname !== "/sign-in") {
    navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { code?: string; field?: string; params?: Record<string, string | number> };
    throw new ApiError(res.status, e.code ?? "error", e.field, e.params);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function useApi<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: unknown }>({});
  const reload = useCallback(
    () =>
      api<T>("GET", path).then(
        (data) => setState({ data }),
        (error) => setState((s) => ({ ...s, error })),
      ),
    [path],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}
