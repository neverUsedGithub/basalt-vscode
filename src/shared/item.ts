import * as z from "zod";

export const Item = z.object({
  minecraftVersion: z.string(),

  id: z.string(),
  count: z.number(),
  components: z.record(z.string(), z.string()),
});

export type IItem = z.infer<typeof Item>;
