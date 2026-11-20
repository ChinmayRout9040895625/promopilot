import { describe, expect, it } from "vitest";
import { formatTimecode, parseTimecode, tryParseTimecode } from "../src/core/timecode";
import { parseEpisode, parsePack, getBeat } from "../src/core/parse";
import { readZipTextFiles } from "../src/core/zip";
import { buildZip, renderEpisode, standardEpisode } from "./fixtures/synthetic";

describe("timecode", () => {
  it("parses MM:SS.cc into integer centiseconds", () => {
    expect(parseTimecode("00:00.00")).toBe(0);
    expect(parseTimecode("00:04.80")).toBe(480);
    expect(parseTimecode("02:18.00")).toBe(13800);
    expect(parseTimecode("03:20.75")).toBe(20075);
    expect(parseTimecode("00:05.8")).toBe(580);
  });
  it("formats centiseconds back to the original format", () => {
    for (const tc of ["00:00.00", "00:04.80", "01:59.99", "03:20.75", "12:00.01"]) {
      expect(formatTimecode(parseTimecode(tc))).toBe(tc);
    }
  });
  it("rejects malformed timecodes", () => {
    for (const bad of ["", "1:2", "00:60.00", "aa:bb.cc", "00:04,80", "-00:01.00"]) {
      expect(tryParseTimecode(bad)).toBeNull();
    }
    expect(() => formatTimecode(1.5)).toThrow();
    expect(() => formatTimecode(-1)).toThrow();
  });
});

describe("parseEpisode", () => {
  it("parses headers, scenes and beats", () => {
    const ep = parseEpisode(standardEpisode(7), "episode-007-Episode 999.txt");
    expect(ep.number).toBe(7);
    expect(ep.logline).toContain("Synthetic logline");
    expect(ep.scenes).toHaveLength(1);
    expect(ep.scenes[0].startCs).toBe(0);
    expect(ep.scenes[0].endCs).toBe(7500);
    expect(ep.durationCs).toBe(7500);
    expect(ep.beats[0].id).toBe("E07-B000");
    const dialogue = ep.beats.filter((b) => b.kind === "dialogue");
    expect(dialogue[0].speaker).toBe("MARA");
    expect(dialogue[0].delivery).toBe("Furious");
    expect(dialogue[0].text).toBe("You sold my father's ship!");
    expect(ep.beats.filter((b) => b.kind === "sfx")).toHaveLength(1);
    expect(ep.warnings).toEqual([]);
  });

  it("accepts uppercase and lowercase scene labels identically", () => {
    const scenes = [
      {
        heading: "INT. ROOM - DAY",
        start: 0,
        end: 1000,
        beats: [{ label: "ACTION", start: 0, end: 1000, text: "A door opens." }],
      },
    ];
    const lower = parseEpisode(renderEpisode({ number: 3, scenes }), "episode-003.txt");
    const upper = parseEpisode(renderEpisode({ number: 3, scenes, upperCaseSceneLabels: true }), "episode-003.txt");
    expect(upper.scenes).toEqual(lower.scenes);
    expect(upper.beats).toEqual(lower.beats);
    expect(upper.scenes[0].heading).toBe("INT. ROOM - DAY");
  });

  it("uses the header episode number and warns on filename mismatch", () => {
    const ep = parseEpisode(standardEpisode(5), "episode-006-Episode 1.txt");
    expect(ep.number).toBe(5);
    expect(ep.warnings.join(" ")).toMatch(/mismatch/);
  });

  it("falls back to the filename when the header number is missing", () => {
    const text = renderEpisode({
      number: 9,
      omitHeaderNumber: true,
      scenes: [{ heading: "X", start: 0, end: 500, beats: [{ label: "ACTION", start: 0, end: 500, text: "x" }] }],
    });
    const ep = parseEpisode(text, "episode-009-Episode 12345.txt");
    expect(ep.number).toBe(9);
  });

  it("sorts out-of-order beats by start time and records a warning", () => {
    const text = renderEpisode({
      number: 1,
      scenes: [
        {
          heading: "X",
          start: 0,
          end: 1000,
          beats: [
            { label: "CAMERA", start: 0, end: 500, text: "a" },
            { label: "BOB (Calm)", start: 310, end: 400, text: '"late"' },
            { label: "AMY (Calm)", start: 300, end: 350, text: '"early"' },
            { label: "CAMERA", start: 500, end: 1000, text: "b" },
          ],
        },
      ],
    });
    const ep = parseEpisode(text, "episode-001.txt");
    expect(ep.beats.map((b) => b.startCs)).toEqual([0, 300, 310, 500]);
    expect(ep.beats.map((b) => b.id)).toEqual(["E01-B000", "E01-B001", "E01-B002", "E01-B003"]);
    expect(ep.beats[1].speaker).toBe("AMY");
    expect(ep.warnings.join(" ")).toMatch(/reordered/);
  });

  it("keeps overlapping beats (camera over dialogue) intact", () => {
    const ep = parseEpisode(standardEpisode(1), "episode-001.txt");
    const cam = ep.beats.find((b) => b.kind === "camera" && b.startCs === 0)!;
    const line = ep.beats.find((b) => b.kind === "dialogue" && b.startCs === 100)!;
    expect(line.startCs).toBeGreaterThanOrEqual(cam.startCs);
    expect(line.endCs).toBeLessThanOrEqual(cam.endCs);
  });

  it("skips beats with malformed or inverted timing and warns", () => {
    const text = [
      "EPISODE NUMBER: Episode 2",
      "SCENE 01",
      "Scene start: 00:00.00",
      "Scene end: 00:10.00",
      "**ACTION:**",
      "Start: (00:00.00) | End: (00:05.00)",
      "Good.",
      "",
      "**ACTION:**",
      "Start: (00:0x.00) | End: (00:05.00)",
      "Bad timing.",
      "",
      "**ACTION:**",
      "Start: (00:08.00) | End: (00:07.00)",
      "Inverted.",
    ].join("\n");
    const ep = parseEpisode(text, "episode-002.txt");
    expect(ep.beats).toHaveLength(1);
    expect(ep.warnings.join(" ")).toMatch(/malformed/);
    expect(ep.warnings.join(" ")).toMatch(/end before start/);
  });

  it("handles a parenthetical off-screen marker", () => {
    const text = renderEpisode({
      number: 1,
      scenes: [{ heading: "X", start: 0, end: 300, beats: [{ label: "MOTHER (O.S.) (Firm)", start: 0, end: 300, text: '"Come home."' }] }],
    });
    const b = parseEpisode(text, "episode-001.txt").beats[0];
    expect(b.speaker).toBe("MOTHER");
    expect(b.offscreen).toBe(true);
    expect(b.delivery).toBe("Firm");
  });

  it("throws when a file has no timed beats", () => {
    expect(() => parseEpisode("EPISODE NUMBER: Episode 1\nnothing here", "episode-001.txt")).toThrow(/No timed beats/);
  });

  it("looks up beats by ID", () => {
    const ep = parseEpisode(standardEpisode(4), "episode-004.txt");
    expect(getBeat(ep, "E04-B002")?.index).toBe(2);
    expect(getBeat(ep, "E04-B999")).toBeUndefined();
    expect(getBeat(ep, "E05-B002")).toBeUndefined();
  });
});

describe("zip + parsePack", () => {
  it("reads only screenplay .txt files from a ZIP and parses them in episode order", async () => {
    const zip = await buildZip({
      "episode-010-Episode 3.txt": standardEpisode(10),
      "episode-002-Episode 1.txt": standardEpisode(2),
      "episode-001-Episode 2.txt": standardEpisode(1),
    });
    const { files, skipped } = await readZipTextFiles(zip);
    expect(files).toHaveLength(3);
    expect(skipped.some((s) => s.includes("readme.md"))).toBe(true);
    expect(skipped.some((s) => s.includes("__MACOSX"))).toBe(true);
    const pack = parsePack(files, skipped);
    expect(pack.errors).toEqual([]);
    expect(pack.episodes.map((e) => e.number)).toEqual([1, 2, 10]);
  });

  it("reports bad files and duplicate episode numbers without failing the pack", async () => {
    const pack = parsePack([
      { fileName: "episode-001.txt", text: standardEpisode(1) },
      { fileName: "episode-001-copy.txt", text: standardEpisode(1) },
      { fileName: "episode-002.txt", text: "garbage" },
    ]);
    expect(pack.episodes).toHaveLength(1);
    expect(pack.errors).toHaveLength(2);
  });
});
