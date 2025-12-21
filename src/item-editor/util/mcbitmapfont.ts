import { BitmapFont, type RawCharData, type Texture } from "pixi.js";

export interface MCFontProvider {
  type: string;
  file: string;
  height?: number;
  ascent: number;
  chars: string[];
}

export interface MCFontData {
  providers: MCFontProvider[];
}

const MC2PAGE = {
  "minecraft:font/ascii.png": 0,
  "minecraft:font/accented.png": 1,
  "minecraft:font/nonlatin_european.png": 2,
};

export class MinecraftBitmapFont {
  constructor(
    private fontName: string,
    private asciiFontTexture: Texture,
    private accentFontTexture: Texture,
    private nonlatinFontTexture: Texture,
    private data: MCFontData,
  ) {}

  generate(): BitmapFont {
    const chars: Record<string, RawCharData> = {};
    const textures = [this.asciiFontTexture, this.accentFontTexture, this.nonlatinFontTexture];

    for (const provider of this.data.providers) {
      const page = MC2PAGE[provider.file as keyof typeof MC2PAGE];
      const height = provider.height ?? 8;

      for (let i = 0; i < provider.chars.length; i++) {
        const width = Math.floor(textures[page]!.width / provider.chars[i]!.length);

        for (let j = 0; j < provider.chars[i]!.length; j++) {
          const id = provider.chars[i]!.charCodeAt(j);

          chars[id] = {
            id,
            page,

            x: j * width,
            y: i * height,

            width,
            height,

            letter: provider.chars[i]![j]!,

            xAdvance: width,

            yOffset: 0,
            xOffset: 0,

            kerning: {},
          };
        }
      }
    }

    return new BitmapFont({
      data: {
        fontFamily: this.fontName,
        fontSize: 8,
        lineHeight: 12,
        baseLineOffset: 0,
        pages: [
          { id: 0, file: "ascii" },
          { id: 1, file: "accent" },
          { id: 2, file: "nonlatin" },
        ],
        chars,
      },
      textures,
    });
  }
}
