import { z } from "zod";

export const AmbiguityHaltSchema = z.object({
  status: z.literal("HALT_AMBIGUOUS_SYMBOL"),
  detectedAmbiguity: z.string(),
  requiredEnums: z.array(z.string()),
  requiresClampedSlider: z.boolean(),
  sliderBounds: z.object({ min: z.number(), max: z.number() }).optional(),
});

export type AmbiguityHalt = z.infer<typeof AmbiguityHaltSchema>;
