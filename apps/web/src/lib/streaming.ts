import { apiHeaders, ApiError } from "@/lib/api/client";
export type StreamEvent = {
  event: string;
  data: {
    delta?: string;
    count?: number;
    error?: string;
    generation_id?: string;
    citations?: import("@/lib/types").Source[];
  };
};
export async function streamAnswer(
  conversationId: string,
  workspaceId: string,
  question: string,
  generationId: string,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const response = await fetch(
    `/api/v1/conversations/${conversationId}/stream`,
    {
      method: "POST",
      credentials: "include",
      headers: apiHeaders(workspaceId),
      body: JSON.stringify({ question, generation_id: generationId }),
      signal,
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      data.detail || "Could not start the response",
    );
  }
  if (!response.body) throw new Error("The server did not provide a stream");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Normalize after joining chunks: CR and LF can arrive in separate reads.
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = frame
          .split("\n")
          .find((l) => l.startsWith("event:"))
          ?.slice(6)
          .trim();
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (event && data) {
          const parsed = JSON.parse(data) as StreamEvent["data"];
          if (event === "generation_completed") completed = true;
          if (event === "generation_failed")
            throw new Error(parsed.error || "Generation failed");
          onEvent({ event, data: parsed });
        }
      }
    }
    if (!completed)
      throw new Error(
        "Connection interrupted. The partial answer was not completed.",
      );
  } finally {
    reader.releaseLock();
  }
}
