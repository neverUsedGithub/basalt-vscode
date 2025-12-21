import type { IItem } from "../../shared/item";

export function hashItemTexture(item: IItem): string {
  return `${item.minecraftVersion}##${item.id}`;
}

export function hashResource(version: string, resource: string): string {
  return `${version}##${resource}`;
}
