import { describe, expect, it } from "vitest";
import { parseEpisode } from "../src/core/parse";
import { runPipeline } from "../src/core/pipeline";
import { toJson } from "../src/core/export";
import { importRunJson, verifyRunAgainst } from "../src/core/importRun";
import { standardEpisode } from "./fixtures/synthetic";

const episodes = [1, 2].map((n) => parseEpisode(standardEpisode(n), `episode-00${n}.txt`));

describe("importRunJson", () => {
  it("round-trips an export without changing promos, scores or ranks", async () => {
    const run = await runPipeline(episodes, {}, { provider: "none", model: "none" });
    const loaded = importRunJson(toJson(run));
    expect(loaded.meta).toEqual(run.meta);
    expect(loaded.promos.map((p) => [p.id, p.rank, p.status, p.headline, p.evaluation.overall])).toEqual(
      run.promos.map((p) => [p.id, p.rank, p.status, p.headline, p.evaluation.overall]),
    );
    expect(loaded.promos.map((p) => p.candidate.segments)).toEqual(run.promos.map((p) => p.candidate.segments));
    expect(verifyRunAgainst(loaded, episodes).failed).toEqual([]);
  });

  it("flags promos whose timestamps do not match the uploaded screenplays", async () => {
    const run = await runPipeline(episodes, {}, { provider: "none", model: "none" });
    const json = JSON.parse(toJson(run));
    json.promos[0].segments[0].start = "00:00.37";
    const loaded = importRunJson(JSON.stringify(json));
    expect(verifyRunAgainst(loaded, episodes).failed.map((f) => f.promoId)).toContain(json.promos[0].promoId);
  });

  it("rejects files that are not results exports", () => {
    expect(() => importRunJson("{")).toThrow(/not valid JSON/);
    expect(() => importRunJson('{"hello":1}')).toThrow(/not a PromoPilot results export/);
  });
});
