import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAnswer, type StreamEvent } from "../src/lib/streaming";

const encoder = new TextEncoder();
function response(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
}
async function consume(chunks: Uint8Array[]) {
  vi.stubGlobal("document", { cookie: "synqra_csrf=test-csrf" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(chunks)));
  const events: StreamEvent[] = [];
  await streamAnswer(
    "conversation-id",
    "workspace-id",
    "question",
    "generation-id",
    new AbortController().signal,
    (event) => events.push(event),
  );
  return events;
}
afterEach(() => vi.unstubAllGlobals());
describe("SSE generation stream", () => {
  it("reassembles byte-split UTF-8 tokens and terminal citations without duplicating text", async () => {
    const source =
      'event: token_delta\ndata: {"delta":"Hello 🌌"}\n\nevent: generation_completed\ndata: {"generation_id":"generation-id","citations":[]}\n\n';
    const events = await consume(
      Array.from(encoder.encode(source), (byte) => new Uint8Array([byte])),
    );
    expect(events.map((e) => e.event)).toEqual([
      "token_delta",
      "generation_completed",
    ]);
    expect(events[0].data.delta).toBe("Hello 🌌");
  });
  it("handles CRLF delimiters even when each byte is a separate network chunk", async () => {
    const source =
      'event: token_delta\r\ndata: {"delta":"Evidence"}\r\n\r\nevent: generation_completed\r\ndata: {"citations":[]}\r\n\r\n';
    const events = await consume(
      Array.from(encoder.encode(source), (byte) => new Uint8Array([byte])),
    );
    expect(events).toHaveLength(2);
    expect(events[0].data.delta).toBe("Evidence");
  });
  it("rejects a dropped connection without a completed event", async () => {
    await expect(
      consume([
        encoder.encode('event: token_delta\ndata: {"delta":"Partial"}\n\n'),
      ]),
    ).rejects.toThrow("Connection interrupted");
  });
  it("surfaces the server's failed-generation reason", async () => {
    await expect(
      consume([
        encoder.encode(
          'event: generation_failed\ndata: {"error":"Unsupported citation"}\n\n',
        ),
      ]),
    ).rejects.toThrow("Unsupported citation");
  });
  it("surfaces an authentication error without opening a stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "Please sign in" }), {
            status: 401,
          }),
        ),
    );
    await expect(
      streamAnswer("c", "w", "q", "g", new AbortController().signal, () => {}),
    ).rejects.toThrow("Please sign in");
  });
  it("passes the abort signal and session-bound headers through fetch", async () => {
    vi.stubGlobal("document", { cookie: "synqra_csrf=session-token" });
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      streamAnswer("c", "w", "q", "g", controller.signal, () => {}),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      signal: controller.signal,
      headers: { "X-CSRF-Token": "session-token", "X-Workspace-Id": "w" },
    });
  });
});
