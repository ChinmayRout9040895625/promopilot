import { z } from "zod";

const score = z.number().int().min(0).max(10);

export const ProposeSchema = z.object({
  candidates: z
    .array(
      z.object({
        start_beat_id: z.string().describe("ID of the first beat of the clip"),
        end_beat_id: z.string().describe("ID of the last beat of the clip"),
        hook_beat_id: z.string().describe("ID of the beat that delivers the hook in the first 3 seconds"),
        cliffhanger_beat_id: z.string().describe("ID of the beat the clip cuts on"),
        pitch: z.string().describe("One sentence: why this moment would stop a scroller"),
      }),
    )
    .max(6),
});
export type ProposeOutput = z.infer<typeof ProposeSchema>;

export const JudgeSchema = z.object({
  evaluations: z.array(
    z.object({
      candidate_id: z.string(),
      scores: z.object({
        hook: score,
        cliffhanger: score,
        standalone: score,
        intensity: score,
        appeal: score,
      }),
      hook: z.string().describe("What happens in the first 3 seconds and why it does or does not stop a scroller"),
      cliffhanger: z.string().describe("The unresolved question the cut leaves, or why the ending feels resolved"),
      why_it_works: z.string().describe("One line on why this promo works (or the main reason it does not)"),
      opening_interesting: z.boolean(),
      ending_creates_curiosity: z.boolean(),
      ending_resolved: z.boolean(),
      makes_sense_alone: z.boolean(),
      confusing_references: z.array(z.string()).describe("Names, places or events a new viewer would not understand"),
      concerns: z.array(z.string()),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
});
export type JudgeOutput = z.infer<typeof JudgeSchema>;

export const StitchSchema = z.object({
  combos: z
    .array(
      z.object({
        segments: z
          .array(z.object({ start_beat_id: z.string(), end_beat_id: z.string() }))
          .min(2)
          .max(3),
        rationale: z.string(),
      }),
    )
    .max(5),
});
export type StitchOutput = z.infer<typeof StitchSchema>;
