import * as PIXI from "pixi.js";
import * as NBT from "@basalt-nbt";
import * as mc from "../../shared/item";
import { hashItemTexture, hashResource } from "./hash";
import {
  ACCENTED_FONT_PATH,
  ASCII_FONT_PATH,
  FONT_DATA_JSON,
  GLINT_TEXTURE_PATH,
  NONLATIN_EUROPEAN_FONT_PATH,
} from "./constant";
import { MinecraftBitmapFont, type MCFontData } from "./mcbitmapfont";
import { buildTooltip } from "./tooltip";

function tryParseSNBT(snbt: string): NBT.Tag | null {
  try {
    return NBT.parseSNBT(snbt);
  } catch {
    return null;
  }
}

function isItemEnchanted(item: mc.IItem): boolean {
  console.log(item.components);

  if ("minecraft:enchantment_glint_override" in item.components) {
    const parsed = tryParseSNBT(item.components["minecraft:enchantment_glint_override"]!.replaceAll("\n", ""));
    return parsed instanceof NBT.ByteTag && parsed.getValue() === 1;
  }

  if ("minecraft:enchantments" in item.components) {
    const parsed = tryParseSNBT(item.components["minecraft:enchantments"]!.replaceAll("\n", ""));
    return parsed instanceof NBT.CompoundTag && parsed.list().length > 0;
  }

  return false;
}

export interface PreviewContext {
  dispose(): void;

  onEditedItem(item: mc.IItem | null): void;
  onTextures(textures: Record<string, string>): void;
  onResources(resources: Record<string, string>): void;
}

async function loadTextureResource(resource: string): Promise<PIXI.Texture> {
  const texture = await PIXI.Assets.load<PIXI.Texture>(`data:image/png;base64,${resource}`);
  texture.source.scaleMode = "nearest";

  return texture;
}

export async function initItemPreview(canvas: HTMLCanvasElement): Promise<PreviewContext> {
  const app = new PIXI.Application();
  await app.init({ canvas, backgroundAlpha: 1, useBackBuffer: true, preference: "webgl" });

  const bgColor = new PIXI.Color(document.documentElement.style.getPropertyValue("--vscode-editor-background"));

  const previewShader = PIXI.Shader.from({
    gl: {
      vertex: /* glsl */ `
          precision mediump float;

          attribute vec2 aPosition;
          attribute vec2 aUV;

          varying vec2 vUV;

          void main(void) {
            vUV = aUV;
            gl_Position = vec4(aPosition, 0.0, 1.0);
          }
        `,
      fragment: /* glsl */ `
          precision mediump float;
        
          uniform vec3 bgColor;

          uniform float scaleX;
          uniform float scaleY;
          
          uniform float hasTexture;
          uniform float isEnchanted;

          uniform float uTime;

          uniform sampler2D uItemSampler;
          uniform sampler2D uGlintSampler;

          varying vec2 vUV;

          void main(void) {
            vec2 cell = floor(gl_FragCoord.xy / vec2(scaleX, scaleY));
            float alpha = max(mod(cell.x + cell.y, 2.0), 0.9);

            vec3 color = bgColor * alpha;

            if (hasTexture == 1.0) {
              vec4 sampled = texture2D(uItemSampler, vUV);
              if (sampled.a > 0.0) {
                vec2 glintUV = vUV + vec2(uTime / 3.0) * vec2(-1, 1);
                vec4 glint = texture2D(uGlintSampler, vec2(mod(glintUV, vec2(1))));

                color = sampled.rgb + glint.rgb * isEnchanted * glint.a * 0.15;
              }
            }

            gl_FragColor = vec4(color, 1.0);
          }
        `,
    },
    resources: {
      uItemSampler: PIXI.Texture.EMPTY.source,
      uGlintSampler: PIXI.Texture.EMPTY.source,

      previewData: {
        scaleX: { value: 0, type: "f32" },
        scaleY: { value: 0, type: "f32" },

        bgColor: { value: bgColor, type: "vec3<f32>" },

        hasTexture: { value: 0, type: "f32" },
        isEnchanted: { value: 0, type: "f32" },

        uTime: { value: 0, type: "f32" },
      },
    },
  });

  const quad = new PIXI.Mesh({
    blendMode: "add",
    geometry: new PIXI.Geometry({
      attributes: {
        aPosition: [
          -1,
          -1, // x, y
          1,
          -1, // x, y
          1,
          1, // x, y,
          -1,
          1, // x, y,
        ],
        aUV: [0, 0, 1, 0, 1, 1, 0, 1],
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    }),
    shader: previewShader,
  });

  app.stage.addChild(quad);

  app.ticker.add(() => {
    const pw = canvas.parentElement!.offsetWidth;
    const ph = canvas.parentElement!.offsetHeight;

    previewShader.resources.previewData.uniforms.uTime += app.ticker.elapsedMS / 1000;

    if (pw !== app.renderer.width || ph !== app.renderer.height) {
      app.renderer.resize(pw, ph);

      const scaleX = pw / 16;
      const scaleY = ph / 16;

      quad.scale.x = scaleX;
      quad.scale.y = scaleY;

      previewShader.resources.previewData.uniforms.scaleX = scaleX;
      previewShader.resources.previewData.uniforms.scaleY = scaleY;
    }
  });

  let _resources: Record<string, string> = {};
  let _textures: Record<string, string> = {};
  let _editedItem: mc.IItem | null;

  let _fonts: {
    ascii: PIXI.Texture;
    accented: PIXI.Texture;
    nonlatin_european: PIXI.Texture;
    data: MCFontData;
  } | null = null;

  async function tryLoadEditedTexture() {
    if (!_editedItem) {
      previewShader.resources.previewData.uniforms.hasTexture = 0;
      previewShader.resources.uItemSampler = PIXI.Texture.EMPTY.source;
      return;
    }

    const itemHash = hashItemTexture(_editedItem);

    if (!(itemHash in _textures)) {
      previewShader.resources.previewData.uniforms.hasTexture = 0;
      previewShader.resources.uItemSampler = PIXI.Texture.EMPTY.source;
      return;
    }

    const texture: PIXI.Texture = await loadTextureResource(_textures[itemHash]!);

    previewShader.resources.previewData.uniforms.hasTexture = 1;
    previewShader.resources.uItemSampler = texture.source;

    if (isItemEnchanted(_editedItem)) tryLoadGlintTexture();
  }

  async function tryLoadGlintTexture() {
    if (!_editedItem) return;
    const hashed = hashResource(_editedItem.minecraftVersion, GLINT_TEXTURE_PATH);

    if (!(hashed in _resources) || !isItemEnchanted(_editedItem)) {
      previewShader.resources.previewData.uniforms.isEnchanted = 0;
      previewShader.resources.uGlintSampler = PIXI.Texture.EMPTY.source;

      return;
    }

    const texture: PIXI.Texture = await loadTextureResource(_resources[hashed]!);

    previewShader.resources.previewData.uniforms.isEnchanted = 1;
    previewShader.resources.uGlintSampler = texture.source;
  }

  async function tryLoadFonts() {
    if (!_editedItem) return;

    const fontDataHash = hashResource(_editedItem.minecraftVersion, FONT_DATA_JSON);
    const asciiFontHash = hashResource(_editedItem.minecraftVersion, ASCII_FONT_PATH);
    const accentedFontHash = hashResource(_editedItem.minecraftVersion, ACCENTED_FONT_PATH);
    const nonlatinFontHash = hashResource(_editedItem.minecraftVersion, NONLATIN_EUROPEAN_FONT_PATH);

    if (
      asciiFontHash in _resources &&
      accentedFontHash in _resources &&
      nonlatinFontHash in _resources &&
      fontDataHash in _resources
    ) {
      const asciiFontTexture: PIXI.Texture = await loadTextureResource(_resources[asciiFontHash]!);
      const accentedFontTexture: PIXI.Texture = await loadTextureResource(_resources[accentedFontHash]!);
      const nonlatinFontTexture: PIXI.Texture = await loadTextureResource(_resources[nonlatinFontHash]!);

      _fonts = {
        ascii: asciiFontTexture,
        accented: accentedFontTexture,
        nonlatin_european: nonlatinFontTexture,
        data: JSON.parse(atob(_resources[fontDataHash]!)),
      };

      console.log(_fonts);

      tryBuildLore();
    }
  }

  let builtTooltip: PIXI.Container | null = null;

  async function tryBuildLore() {
    console.log("BUILD LORE");

    if (builtTooltip) builtTooltip.destroy();
    if (!_editedItem) return;
    if (!_fonts) return;

    builtTooltip = new PIXI.Container();

    const mcBitmapFont = new MinecraftBitmapFont(
      `MCFONT-${_editedItem.minecraftVersion}`,
      _fonts.ascii,
      _fonts.accented,
      _fonts.nonlatin_european,
      _fonts.data,
    );

    mcBitmapFont.generate();

    console.log("BUILD TOOLTIP");
    builtTooltip = buildTooltip(["hi", "hello"]);

    app.stage.addChild(builtTooltip);
  }

  return {
    dispose: () => {
      app.destroy();
    },

    onTextures: (textures) => {
      _textures = textures;
      tryLoadEditedTexture();
    },

    onResources: (resources) => {
      _resources = resources;

      tryLoadGlintTexture();
      tryLoadFonts();
    },

    onEditedItem: (item) => {
      _editedItem = item;

      tryLoadEditedTexture();
      tryBuildLore();
    },
  };
}
