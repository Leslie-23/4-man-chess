import { describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

describe("coming-soon votes", () => {
  it("counts one bid per visitor per game, lists them with an open CORS header, and rejects unknown games", async () => {
    const { app } = buildServer({ complete: null, voice: null });
    const from = (ip: string) => ({ "x-forwarded-for": ip });
    const first = await app.inject({ method: "POST", url: "/votes/ludo", headers: from("1.1.1.1") });
    expect(first.json()).toMatchObject({ counted: true, votes: { ludo: 1, oware: 0 } });
    expect(first.headers["access-control-allow-origin"]).toBe("*");
    expect((await app.inject({ method: "POST", url: "/votes/ludo", headers: from("1.1.1.1") })).json()).toMatchObject({ counted: false, votes: { ludo: 1 } });
    await app.inject({ method: "POST", url: "/votes/ludo", headers: from("2.2.2.2") });
    expect((await app.inject({ method: "GET", url: "/votes" })).json().votes.ludo).toBe(2);
    expect((await app.inject({ method: "POST", url: "/votes/snakes" })).statusCode).toBe(404);
    await app.close();
  });
});
