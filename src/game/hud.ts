import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { TABLE_W, TABLE_H } from "../physics/layout";

const scoreStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "800",
  fontSize: 24,
  fill: 0xffffff,
  stroke: { color: 0x0a0a12, width: 5 },
});

const smallStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "700",
  fontSize: 14,
  fill: 0xd7dbe6,
  stroke: { color: 0x0a0a12, width: 4 },
});

const bannerStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "900",
  fontSize: 34,
  fill: 0xffe066,
  stroke: { color: 0x4a2a00, width: 7 },
  align: "center",
  wordWrap: true,
  wordWrapWidth: TABLE_W - 20,
  breakWords: true,
});

const titleStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "900",
  fontSize: 46,
  fill: 0xffe066,
  stroke: { color: 0x2a1000, width: 9 },
  align: "center",
});

const subStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "700",
  fontSize: 17,
  fill: 0xffffff,
  stroke: { color: 0x0a0a12, width: 4 },
  align: "center",
  wordWrap: true,
  wordWrapWidth: TABLE_W - 50,
  breakWords: true,
  lineHeight: 26,
});

const cardTitleStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "900",
  fontSize: 20,
  fill: 0xffe066,
  stroke: { color: 0x2a1000, width: 5 },
});

const cardDescStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "600",
  fontSize: 14,
  fill: 0xffffff,
  wordWrap: true,
  wordWrapWidth: TABLE_W - 100,
  breakWords: true,
  lineHeight: 19,
});

const choiceHeaderStyle = new TextStyle({
  fontFamily: "Arial, sans-serif",
  fontWeight: "900",
  fontSize: 26,
  fill: 0xffffff,
  stroke: { color: 0x0a0a12, width: 6 },
  align: "center",
});

export interface ChoiceItem {
  label: string;
  desc: string;
}

interface ChoiceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CARD_W = TABLE_W - 60;
const CARD_H = 108;
const CARD_GAP = 16;
const CARD_START_Y = TABLE_H * 0.28;
const MAX_CARDS = 3;

export class HUD {
  container: Container;
  private scoreText: Text;
  private ballsText: Text;
  private buildingsText: Text;
  private comboBarBg: Graphics;
  private comboBarFill: Graphics;
  private comboText: Text;
  private bannerText: Text;
  private bannerTimer = 0;

  titleScreen: Container;
  gameOverScreen: Container;
  private finalScoreText!: Text;
  private launchHint!: Text;

  private choiceScreen: Container;
  private choiceHeader: Text;
  private choiceCardBgs: Graphics[] = [];
  private choiceCardTitles: Text[] = [];
  private choiceCardDescs: Text[] = [];
  private choiceRects: ChoiceRect[] = [];

  constructor() {
    this.container = new Container();

    const topBar = new Graphics().rect(0, 0, TABLE_W, 46).fill({ color: 0x05050a, alpha: 0.55 });
    this.container.addChild(topBar);

    this.scoreText = new Text({ text: "0", style: scoreStyle });
    this.scoreText.position.set(10, 6);
    this.container.addChild(this.scoreText);

    this.ballsText = new Text({ text: "BALL x3", style: smallStyle });
    this.ballsText.anchor.set(1, 0);
    this.ballsText.position.set(TABLE_W - 10, 8);
    this.container.addChild(this.ballsText);

    this.buildingsText = new Text({ text: "FLOOR 1  建物 6/6", style: { ...smallStyle, fontSize: 11 } });
    this.buildingsText.position.set(10, 30);
    this.container.addChild(this.buildingsText);

    this.comboBarBg = new Graphics();
    this.comboBarFill = new Graphics();
    this.comboBarBg.position.set(TABLE_W - 190, 46);
    this.comboBarFill.position.set(TABLE_W - 190, 46);
    this.container.addChild(this.comboBarBg, this.comboBarFill);

    this.comboText = new Text({ text: "MULTIBALL 0/8", style: { ...smallStyle, fontSize: 11 } });
    this.comboText.anchor.set(1, 0);
    this.comboText.position.set(TABLE_W - 10, 28);
    this.container.addChild(this.comboText);

    this.bannerText = new Text({ text: "", style: bannerStyle });
    this.bannerText.anchor.set(0.5);
    this.bannerText.position.set(TABLE_W / 2, TABLE_H * 0.4);
    this.bannerText.alpha = 0;
    this.container.addChild(this.bannerText);

    this.launchHint = new Text({ text: "TAP TO LAUNCH", style: { ...bannerStyle, fontSize: 22 } });
    this.launchHint.anchor.set(0.5);
    this.launchHint.position.set(TABLE_W / 2, TABLE_H - 130);
    this.launchHint.visible = false;
    this.container.addChild(this.launchHint);

    this.titleScreen = this.buildTitleScreen();
    this.gameOverScreen = this.buildGameOverScreen();
    const choice = this.buildChoiceScreen();
    this.choiceScreen = choice.container;
    this.choiceHeader = choice.header;
    this.container.addChild(this.titleScreen, this.gameOverScreen, this.choiceScreen);
    this.gameOverScreen.visible = false;
    this.choiceScreen.visible = false;
  }

  private buildTitleScreen(): Container {
    const c = new Container();
    const bg = new Graphics().rect(0, 0, TABLE_W, TABLE_H).fill({ color: 0x05050a, alpha: 0.86 });
    c.addChild(bg);

    const title = new Text({ text: "KAIJU\nPINBALL", style: titleStyle });
    title.anchor.set(0.5);
    title.position.set(TABLE_W / 2, TABLE_H * 0.26);
    c.addChild(title);

    const sub = new Text({
      text: "全ての建物を持ち球が尽きる前に破壊せよ。\n倒れた建物から逃げる人間を踏み潰すとマルチボール。\nフロアをクリアするたびに強化を1つ選べる。\n\nタップで開始\n画面左右タップでフリッパー操作",
      style: subStyle,
    });
    sub.anchor.set(0.5);
    sub.position.set(TABLE_W / 2, TABLE_H * 0.48);
    c.addChild(sub);

    const prompt = new Text({ text: "TAP TO START", style: { ...bannerStyle, fontSize: 24 } });
    prompt.anchor.set(0.5);
    prompt.position.set(TABLE_W / 2, TABLE_H * 0.78);
    c.addChild(prompt);
    c.label = "titlePrompt";

    // simple pulse animation handled in update()
    (c as unknown as { prompt: Text }).prompt = prompt;

    return c;
  }

  private buildGameOverScreen(): Container {
    const c = new Container();
    const bg = new Graphics().rect(0, 0, TABLE_W, TABLE_H).fill({ color: 0x05050a, alpha: 0.86 });
    c.addChild(bg);

    const title = new Text({ text: "GAME OVER", style: titleStyle });
    title.anchor.set(0.5);
    title.position.set(TABLE_W / 2, TABLE_H * 0.34);
    c.addChild(title);

    this.finalScoreText = new Text({ text: "SCORE 0", style: { ...bannerStyle, fontSize: 28 } });
    this.finalScoreText.anchor.set(0.5);
    this.finalScoreText.position.set(TABLE_W / 2, TABLE_H * 0.46);
    c.addChild(this.finalScoreText);

    const prompt = new Text({ text: "TAP TO RETRY", style: { ...subStyle, fontSize: 20 } });
    prompt.anchor.set(0.5);
    prompt.position.set(TABLE_W / 2, TABLE_H * 0.58);
    c.addChild(prompt);

    return c;
  }

  private buildChoiceScreen(): { container: Container; header: Text } {
    const c = new Container();
    const bg = new Graphics().rect(0, 0, TABLE_W, TABLE_H).fill({ color: 0x05050a, alpha: 0.9 });
    c.addChild(bg);

    const header = new Text({ text: "", style: choiceHeaderStyle });
    header.anchor.set(0.5, 0);
    header.position.set(TABLE_W / 2, CARD_START_Y - 56);
    c.addChild(header);

    for (let i = 0; i < MAX_CARDS; i++) {
      const y = CARD_START_Y + i * (CARD_H + CARD_GAP);
      const x = (TABLE_W - CARD_W) / 2;

      const cardBg = new Graphics();
      cardBg.position.set(x, y);
      c.addChild(cardBg);
      this.choiceCardBgs.push(cardBg);

      const cardTitle = new Text({ text: "", style: cardTitleStyle });
      cardTitle.position.set(x + 18, y + 14);
      c.addChild(cardTitle);
      this.choiceCardTitles.push(cardTitle);

      const cardDesc = new Text({ text: "", style: cardDescStyle });
      cardDesc.position.set(x + 18, y + 44);
      c.addChild(cardDesc);
      this.choiceCardDescs.push(cardDesc);

      this.choiceRects.push({ x, y, w: CARD_W, h: CARD_H });
    }

    return { container: c, header };
  }

  showTitle() {
    this.titleScreen.visible = true;
  }

  hideTitle() {
    this.titleScreen.visible = false;
  }

  showGameOver(score: number, floor: number) {
    this.finalScoreText.text = `SCORE ${score.toLocaleString()}\nFLOOR ${floor} で全滅`;
    this.gameOverScreen.visible = true;
  }

  hideGameOver() {
    this.gameOverScreen.visible = false;
  }

  /** Shows up to MAX_CARDS selectable cards; returns nothing, selection is via hitTestChoice(). */
  showChoices(header: string, items: ChoiceItem[]) {
    this.choiceHeader.text = header;
    for (let i = 0; i < MAX_CARDS; i++) {
      const active = i < items.length;
      this.choiceCardBgs[i].visible = active;
      this.choiceCardTitles[i].visible = active;
      this.choiceCardDescs[i].visible = active;
      if (!active) continue;
      const item = items[i];
      this.choiceCardBgs[i]
        .clear()
        .roundRect(0, 0, CARD_W, CARD_H, 12)
        .fill({ color: 0x1c2233, alpha: 0.95 })
        .stroke({ width: 2, color: 0xffe066, alpha: 0.8 });
      this.choiceCardTitles[i].text = item.label;
      this.choiceCardDescs[i].text = item.desc;
    }
    this.choiceScreen.visible = true;
  }

  hideChoices() {
    this.choiceScreen.visible = false;
  }

  /** Returns the index of the choice card at (x, y) in table-space, or null. */
  hitTestChoice(x: number, y: number): number | null {
    if (!this.choiceScreen.visible) return null;
    for (let i = 0; i < this.choiceRects.length; i++) {
      if (!this.choiceCardBgs[i].visible) continue;
      const r = this.choiceRects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return null;
  }

  setLaunchHint(visible: boolean) {
    this.launchHint.visible = visible;
  }

  setScore(score: number) {
    this.scoreText.text = score.toLocaleString();
  }

  setBalls(reserve: number, active: number) {
    this.ballsText.text = active > 1 ? `BALL x${reserve}  (${active} IN PLAY)` : `BALL x${reserve}`;
  }

  setBuildingsRemaining(remaining: number, total: number, floor: number, isBoss: boolean) {
    this.buildingsText.text = `FLOOR ${floor}${isBoss ? " (BOSS)" : ""}  建物 ${remaining}/${total}`;
  }

  setCombo(current: number, threshold: number) {
    const w = 190;
    const t = Math.min(1, current / threshold);
    this.comboBarBg.clear().roundRect(0, 0, w, 8, 4).fill({ color: 0xffffff, alpha: 0.15 });
    this.comboBarFill.clear();
    if (t > 0) this.comboBarFill.roundRect(0, 0, Math.max(8, w * t), 8, 4).fill(0xff5a3c);
    this.comboText.text = `MULTIBALL ${current}/${threshold}`;
  }

  clearBanner() {
    this.bannerTimer = 0;
    this.bannerText.alpha = 0;
  }

  showBanner(text: string, duration = 1.3) {
    this.bannerText.text = text;
    this.bannerText.alpha = 1;
    this.bannerText.scale.set(0.7);
    this.bannerTimer = duration;
  }

  update(dt: number) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      this.bannerText.scale.x = Math.min(1, this.bannerText.scale.x + dt * 4);
      this.bannerText.scale.y = this.bannerText.scale.x;
      if (this.bannerTimer <= 0) this.bannerText.alpha = 0;
      else if (this.bannerTimer < 0.3) this.bannerText.alpha = this.bannerTimer / 0.3;
    }

    if (this.titleScreen.visible) {
      const prompt = (this.titleScreen as unknown as { prompt: Text }).prompt;
      if (prompt) prompt.alpha = 0.6 + Math.sin(performance.now() / 260) * 0.4;
    }
    if (this.launchHint.visible) {
      this.launchHint.alpha = 0.6 + Math.sin(performance.now() / 220) * 0.4;
    }
  }
}
