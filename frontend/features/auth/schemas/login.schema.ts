import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(320, "Email must be 320 characters or less"),
});

export type LoginFormValues =
  z.infer<typeof loginSchema>;
