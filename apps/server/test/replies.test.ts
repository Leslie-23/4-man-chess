import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GROQ_MODEL, groqComplete } from "../src/replies.js";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("groqComplete", () => {
  it("asks reasoning models to think briefly and keep the thinking out of the reply", async () => {
    const fetch = vi.fn(async () => reply({ choices: [{ message: { content: "Nice move." }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await groqComplete("key", DEFAULT_GROQ_MODEL)([{ role: "user", content: "hi" }])).toBe("Nice move.");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 1024,
    });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer key");
  });

  it("leaves reasoning settings off for other models", async () => {
    const fetch = vi.fn(async () => reply({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetch);
    await groqComplete("key", "some/other-model")([{ role: "user", content: "hi" }]);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.max_completion_tokens).toBe(200);
  });

  it("logs why when Groq refuses or sends nothing back, and returns null", async () => {
    const log = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { message: "The model has been decommissioned" } }, 400)));
    expect(await groqComplete("key", "old-model", log)([{ role: "user", content: "hi" }])).toBeNull();
    expect(String(log.mock.calls[0]![0])).toContain("decommissioned");

    vi.stubGlobal("fetch", vi.fn(async () => reply({ choices: [{ message: { content: "" }, finish_reason: "length" }] })));
    expect(await groqComplete("key", DEFAULT_GROQ_MODEL, log)([{ role: "user", content: "hi" }])).toBeNull();
    expect(String(log.mock.calls[1]![0])).toContain("finish_reason: length");
  });
});
