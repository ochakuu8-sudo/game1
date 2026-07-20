import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { Atlas } from "../core/atlas";
import { TABLE_W, TABLE_H } from "../physics/layout";
import type { PowerUpChoice } from "./powerups";

const CARD_W = 112;
const CARD_H = 150;
const GAP = 14;
const MAX_CARDS = 3;

const titleStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "900",
  fontSize: 26,
  fill: 0xffe066,
  stroke: { color: 0x2a1000, width: 6 },
  align: "center",
});

const labelStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "800",
  fontSize: 13,
  fill: 0xffffff,
  stroke: { color: 0x0a0a12, width: 4 },
  align: "center",
  wordWrap: true,
  wordWrapWidth: CARD_W - 12,
  lineHeight: 16,
});

const descStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "600",
  fontSize: 11,
  fill: 0xd7dbe6,
  stroke: { color: 0x0a0a12, width: 3 },
  align: "center",
  wordWrap: true,
  wordWrapWidth: CARD_W - 14,
  lineHeight: 14,
});

interface Card {
  root: Container;
  bg: Graphics;
  icon: Sprite;
  label: Text;
  desc: Text;
}

/** Full-board modal that lets the player pick one of several offered buffs. */
export class PowerUpSelect {
  container: Container;
  private cards: Card[] = [];
  private choices: PowerUpChoice[] = [];
  private onPick: ((choice: PowerUpChoice) => void) | null = null;

  constructor(atlas: Atlas) {
    this.container = new Container();
    this.container.visible = false;

    const overlay = new Graphics().rect(0, 0, TABLE_W, TABLE_H).fill({ color: 0x05050a, alpha: 0.86 });
    this.container.addChild(overlay);

    const title = new Text({ text: "強化を選べ！", style: titleStyle });
    title.anchor.set(0.5);
    title.position.set(TABLE_W / 2, TABLE_H * 0.34);
    this.container.addChild(title);

    for (let i = 0; i < MAX_CARDS; i++) {
      const root = new Container();
      root.eventMode = "static";
      root.cursor = "pointer";

      const bg = new Graphics();
      root.addChild(bg);

      const icon = new Sprite(atlas.star);
      icon.anchor.set(0.5);
      icon.width = icon.height = 44;
      icon.position.set(CARD_W / 2, 42);
      root.addChild(icon);

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
      this.cards.push({ root, bg, icon, label, desc });
    }
  }

  show(choices: PowerUpChoice[], onPick: (choice: PowerUpChoice) => void) {
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
        .roundRect(0, 0, CARD_W, CARD_H, 12)
        .fill({ color: 0x1c2230, alpha: 0.95 })
        .stroke({ width: 2, color: choice.color });
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
