import * as z from "zod";

export const MainTaskOutputSchema = z.object({
  reply: z.string(),
  used_skills: z.array(z.string()).default([]),
});

export type MainTaskOutput = z.infer<typeof MainTaskOutputSchema>;
