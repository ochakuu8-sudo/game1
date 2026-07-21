import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import { PALETTE } from "../core/palette";
import { TABLE_W, TABLE_H } from "../physics/layout";

const CARD_W = 112;
const CARD_H = 150;
const GAP = 14;
const MAX_CARDS = 3;

const RETRO_FONT = '"Courier New", ui-monospace, monospace';

const titleStyle = new TextStyle({
  fontFamily: RETRO_FONT,
  fontWeight: "700",
  fontSize: 26,
  fill: PALETTE.gold,
  stroke: { color: PALETTE.ink, width: 6, join: "miter" },
  align: "center",
});

const labelStyle = new TextStyle({
  fontFamily: RETRO_FONT,
  fontWeight: "700",
  fontSize: 13,
  fill: PALETTE.paper,
  stroke: { color: PALETTE.ink, width: 4, join: "miter" },
  align: "center",
  wordWrap: true,
  wordWrapWidth: CARD_W - 12,
  lineHeight: 16,
});

const descStyle = new TextStyle({
  fontFamily: RETRO_FONT,
  fontWeight: "700",
  fontSize: 11,
  fill: PALETTE.streetLine,
  stroke: { color: PALETTE.ink, width: 3, join: "miter" },
  align: "center",
  wordWrap: true,
  wordWrapWidth: CARD_W - 14,
  lineHeight: 14,
});

export interface CardChoice {
  label: string;
  description: string;
  color: number;
}

interface Card {
  root: Container;
  bg: Graphics;
  icon: Sprite;
  label: Text;
  desc: Text;
}

/** Full-board modal that lets the player pick one of several offered
 * choices, shown as up to 3 cards - shared by the power-up and
 * building-type pickers (game/powerupSelect.ts, game/buildingSelect.ts). */
export class CardSelect<T extends CardChoice> {
  container: Container;
  private cards: Card[] = [];
  private choices: T[] = [];
  private onPick: ((choice: T) => void) | null = null;

  constructor(icon: Texture, title: string) {
    this.container = new Container();
    this.container.visible = false;

    const overlay = new Graphics()
      .rect(0, 0, TABLE_W, TABLE_H)
      .fill({ color: PALETTE.ink, alpha: 0.88 })
      .rect(10, 10, TABLE_W - 20, TABLE_H - 20)
      .stroke({ width: 3, color: PALETTE.gold, alpha: 0.6 });
    this.container.addChild(overlay);

    const titleText = new Text({ text: title, style: titleStyle });
    titleText.anchor.set(0.5);
    titleText.position.set(TABLE_W / 2, TABLE_H * 0.34);
    this.container.addChild(titleText);

    for (let i = 0; i < MAX_CARDS; i++) {
      const root = new Container();
      root.eventMode = "static";
      root.cursor = "pointer";

      const bg = new Graphics();
      root.addChild(bg);

      const iconSprite = new Sprite(icon);
      iconSprite.anchor.set(0.5);
      iconSprite.width = iconSprite.height = 44;
      iconSprite.position.set(CARD_W / 2, 42);
      root.addChild(iconSprite);

      const label = new Text({ text: "", style: labelStyle });
      label.anchor.set(0.5, 0);
      label.position.set(CARD_W / 2, 76);
      root.addChild(label);

      const desc = new Text({ text: "", style: descStyle });
      desc.anchor.set(0.5, 0);
      desc.position.set(CARD_W / 2, 108);
      root.addChild(desc);

      root.on("pointerdown", () => root.scale.set(0.94));
      root.on("pointerup", () => root.scale.set(1));
      root.on("pointerupoutside", () => root.scale.set(1));
      root.on("pointertap", () => this.pick(i));

      this.container.addChild(root);
      this.cards.push({ root, bg, icon: iconSprite, label, desc });
    }
  }

  show(choices: T[], onPick: (choice: T) => void) {
    this.choices = choices;
    this.onPick = onPick;

    const n = choices.length;
    const totalW = n * CARD_W + Math.max(0, n - 1) * GAP;
    const startX = TABLE_W / 2 - totalW / 2;
    const y = TABLE_H * 0.47;

    this.cards.forEach((card, i) => {
      const choice = choices[i];
      card.root.visible = !!choice;
      if (!choice) return;

      card.root.scale.set(1);
      card.root.position.set(startX + i * (CARD_W + GAP), y);
      card.bg
        .clear()
        .rect(0, 0, CARD_W, CARD_H)
        .fill(PALETTE.skyDeep)
        .rect(0, 0, CARD_W, CARD_H)
        .stroke({ width: 3, color: choice.color });
      card.icon.tint = choice.color;
      card.label.text = choice.label;
      card.desc.text = choice.description;
    });

    this.container.visible = true;
  }

  private pick(index: number) {
    const choice = this.choices[index];
    if (!choice || !this.onPick) return;
    const cb = this.onPick;
    this.container.visible = false;
    this.onPick = null;
    cb(choice);
  }
}
