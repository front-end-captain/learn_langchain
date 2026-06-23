import * as z from "zod";

export const testAttachmentSchema = z
  .object({
    file_path: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    file_name: z.string().min(1).optional().nullable(),
  })
  .transform((value, ctx) => {
    const filePath = value.file_path ?? value.filePath;
    if (!filePath) {
      ctx.addIssue({
        code: "custom",
        path: ["file_path"],
        message: "file_path is required",
      });
      return z.NEVER;
    }

    return {
      file_path: filePath,
      file_name: value.file_name ?? null,
    };
  });

export const testRequestSchema = z.object({
  routing_key: z.string().min(1),
  content: z.string().default(""),
  msg_id: z.string().min(1).optional().nullable(),
  sender_id: z.string().min(1).default("ou_test001"),
  attachment: testAttachmentSchema.optional().nullable(),
});

export type TestAttachment = z.infer<typeof testAttachmentSchema>;
export type TestRequest = z.infer<typeof testRequestSchema>;

export interface TestResponse {
  msg_id: string;
  reply: string;
  session_id: string;
  duration_ms: number;
  skills_called: string[];
}
