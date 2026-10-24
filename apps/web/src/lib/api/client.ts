export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function csrfToken(): string {
  return typeof document === "undefined"
    ? ""
    : decodeURIComponent(
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("synqra_csrf="))
          ?.split("=")[1] || "",
      );
}
export function apiHeaders(workspaceId?: string, json = true): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "X-CSRF-Token": csrfToken(),
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
  };
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  workspaceId?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...apiHeaders(workspaceId, !(options.body instanceof FormData)),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Cannot reach SYNQRA. Check that the API is running.",
    );
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new ApiError(
      response.status,
      typeof error?.detail === "string"
        ? error.detail
        : `Request failed (${response.status}). Check the API connection.`,
    );
  }
  return response.json() as Promise<T>;
}
export const json = (body: unknown): Pick<RequestInit, "body"> => ({
  body: JSON.stringify(body),
});
