import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, apiHeaders } from "../src/lib/api/client";
afterEach(() => vi.unstubAllGlobals());
describe("central API client", () => {
  it("adds cookies, workspace scope and the correct decoded CSRF token", async () => {
    vi.stubGlobal("document", { cookie: "other=1; synqra_csrf=csrf%2Btoken" });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ id: "document" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/documents", {}, "workspace")).resolves.toEqual({
      id: "document",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/documents");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      headers: { "X-Workspace-Id": "workspace", "X-CSRF-Token": "csrf+token" },
    });
  });
  it("lets the browser supply multipart boundaries on document uploads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "queued" }));
    vi.stubGlobal("fetch", fetchMock);
    await api(
      "/documents",
      { method: "POST", body: new FormData() },
      "workspace",
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "Content-Type",
    );
  });
  it("keeps a server authorization error's HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ detail: "Workspace access denied" }, { status: 403 }),
        ),
    );
    await expect(api("/documents")).rejects.toMatchObject({
      status: 403,
      message: "Workspace access denied",
    });
  });
  it("returns a useful error when the proxy sends a non-JSON failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })),
    );
    await expect(api("/documents")).rejects.toBeInstanceOf(ApiError);
  });
  it("reports network failure separately from an HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(api("/documents")).rejects.toMatchObject({ status: 0 });
  });
  it("does not invent an active workspace or CSRF token during server rendering", () => {
    vi.stubGlobal("document", undefined);
    expect(apiHeaders()).toEqual({
      "Content-Type": "application/json",
      "X-CSRF-Token": "",
    });
  });
});
