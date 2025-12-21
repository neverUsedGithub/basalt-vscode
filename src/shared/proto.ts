import * as z from "zod";
import { Item } from "./item";

export const GetItemTextureMessage = z.object({
  type: z.literal("get-item-texture"),
  item: Item,
});

export const UpdateItemMessage = z.object({
  type: z.literal("update-item"),
  item: Item.nullable(),
});

export const UpdateMinecraftVersionsMessage = z.object({
  type: z.literal("update-versions"),
  versions: z.array(z.string()),
});

export const ReadyMessage = z.object({
  type: z.literal("ready"),
});

export const ItemTextureResponseMessage = z.object({
  type: z.literal("item-texture"),
  item: Item,
  texture: z.string(),
});

export const GetAnyResourceMessage = z.object({
  type: z.literal("get-resource"),
  version: z.string(),
  resource: z.string(),
});

export const AnyResourceResponseMessage = z.object({
  type: z.literal("resource"),
  version: z.string(),
  resource: z.string(),
  texture: z.string(),
});

export const UpdateItemComponentsMessage = z.object({
  type: z.literal("update-item-components"),
  components: z.array(z.string()),
});

export const ServerMessages = ItemTextureResponseMessage.or(UpdateItemMessage)
  .or(UpdateMinecraftVersionsMessage)
  .or(AnyResourceResponseMessage)
  .or(UpdateItemComponentsMessage);

export const ClientMessages = GetItemTextureMessage.or(UpdateItemMessage).or(ReadyMessage).or(GetAnyResourceMessage);

export type IServerMessages = z.infer<typeof ServerMessages>;
export type IClientMessages = z.infer<typeof ClientMessages>;
