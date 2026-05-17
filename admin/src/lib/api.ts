export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new ApiError(response.status, message || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const MIN_REFRESH_MS = 450;

export async function withMinRefreshDuration(run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await run();
  const remaining = MIN_REFRESH_MS - (Date.now() - started);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
