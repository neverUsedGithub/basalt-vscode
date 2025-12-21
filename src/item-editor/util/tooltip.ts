import * as PIXI from "pixi.js";

type MCText =
  | string
  | MCText[]
  | {
      type?: string;

      text: string;
      color?: string;
      font?: string;

      bold?: boolean;
      italic?: boolean;
      underlined?: boolean;
      strikethrough?: boolean;
      obfuscated?: boolean;

      shadow_color?: number | [number, number, number, number];

      insertion?: string;
      click_event?: unknown;
      hover_event?: unknown;

      extra?: MCText[];
    };

export const MINECRAFT_COLORS: Record<string, PIXI.Color> = {
  black: new PIXI.Color("#000000"),
  dark_blue: new PIXI.Color("#0000AA"),
  dark_green: new PIXI.Color("#00AA00"),
  dark_aqua: new PIXI.Color("#00AAAA"),
  dark_red: new PIXI.Color("#AA0000"),
  dark_purple: new PIXI.Color("#AA00AA"),
  gold: new PIXI.Color("#FFAA00"),
  gray: new PIXI.Color("#AAAAAA"),
  dark_gray: new PIXI.Color("#555555"),
  blue: new PIXI.Color("#5555FF"),
  green: new PIXI.Color("#55FF55"),
  aqua: new PIXI.Color("#55FFFF"),
  red: new PIXI.Color("#FF5555"),
  light_purple: new PIXI.Color("#FF55FF"),
  yellow: new PIXI.Color("#FFFF55"),
  white: new PIXI.Color("#FFFFFF"),
};

const TOOLTIP_DEFAULT_TEXT_COLOR = new PIXI.Color("#ffffff");

const TOOLTIP_COLOR = new PIXI.Color("#000000");
const TOOLTIP_ACCENT_COLOR = new PIXI.Color("#2C0863");

const TOOLTIP_BORDER_RADIUS = 2;

const TOOLTIP_PADDING_OUT_X = 8;
const TOOLTIP_PADDING_OUT_Y = 8;

const TOOLTIP_PADDING_INNER_X = 8;
const TOOLTIP_PADDING_INNER_Y = 8;

const DEFAULT_TEXT_STYLE: Partial<PIXI.TextStyleOptions> = {
  fontFamily: "text-font",
  fontSize: 24,
};

function getTooltipTextStyle(options: Partial<PIXI.TextStyleOptions>): PIXI.TextStyle {
  return new PIXI.TextStyle(Object.assign({}, DEFAULT_TEXT_STYLE, options));
}

function toPIXIColor(color: string): PIXI.Color {
  if (color in DEFAULT_TEXT_STYLE) return MINECRAFT_COLORS[color]!;
  return new PIXI.Color(color);
}

export function buildTooltip(lines: MCText[]): PIXI.Container {
  const textContainer = new PIXI.Container();

  let currentY = 0;
  let maxWidth = 0;

  for (const line of lines) {
    const parts: [MCText, PIXI.Color][] = [[line, TOOLTIP_DEFAULT_TEXT_COLOR]];

    let currentX = 0;
    let textHeight = 0;

    while (parts.length > 0) {
      const [top, parentColor] = parts.shift()!;

      if (Array.isArray(top)) {
        parts.push(...top.map((text) => [text, parentColor] as [MCText, PIXI.Color]));
        continue;
      }

      let text: PIXI.Text;

      if (typeof top === "string") {
        text = new PIXI.Text({
          text: top,
          style: getTooltipTextStyle({ fill: parentColor }),
        });
      } else {
        text = new PIXI.Text({
          text: top.text,
          style: getTooltipTextStyle({
            fill: top.color ? toPIXIColor(top.color) : parentColor,
          }),
        });

        if (top.extra)
          parts.push(...top.extra.map((child) => [child, top.color ?? parentColor] as [MCText, PIXI.Color]));
      }

      text.resolution = window.devicePixelRatio * 2;
      text.position.x = currentX;
      text.position.y = currentY;

      currentX += text.width;
      textHeight = Math.max(0, text.height);

      textContainer.addChild(text);
    }

    maxWidth = Math.max(maxWidth, currentX);
    currentY += textHeight;
  }

  const tooltipContainer = new PIXI.Container();

  textContainer.position.x = TOOLTIP_PADDING_OUT_X + TOOLTIP_PADDING_INNER_X;
  textContainer.position.y = TOOLTIP_PADDING_OUT_Y + TOOLTIP_PADDING_INNER_Y;

  tooltipContainer.addChild(
    new PIXI.Graphics()
      .rect(
        0,
        0,
        maxWidth + TOOLTIP_PADDING_OUT_X * 2 + TOOLTIP_PADDING_INNER_X * 2,
        currentY + TOOLTIP_PADDING_OUT_Y * 2 + TOOLTIP_PADDING_INNER_Y * 2,
      )
      .fill(TOOLTIP_COLOR)

      .roundRect(
        TOOLTIP_PADDING_OUT_X,
        TOOLTIP_PADDING_OUT_Y,
        maxWidth + TOOLTIP_PADDING_OUT_X + TOOLTIP_PADDING_INNER_X,
        currentY + TOOLTIP_PADDING_OUT_Y + TOOLTIP_PADDING_INNER_Y,
        TOOLTIP_BORDER_RADIUS,
      )
      .stroke({ width: 2, color: TOOLTIP_ACCENT_COLOR }),
  );

  tooltipContainer.addChild(textContainer);

  return tooltipContainer;
}
