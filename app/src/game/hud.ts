import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { TABLE_W, TABLE_H } from "../physics/layout";
import { PALETTE } from "../core/palette";

// A blocky monospace stack reads closest to a retro cartridge font without
// needing a full hand-drawn bitmap glyph set for arbitrary (incl. Japanese)
// UI text - every other visual in the game is built from rect() blocks,
// see core/atlas.ts.
const RETRO_FONT = '"Courier New", ui-monospace, monospace';

const scoreStyle = new TextStyle({
  fontFamily: RETRO_FONT,
  fontWeight: "700",
  fontSize: 24,
  fill: PALETTE.paper,
  stroke: { color: PALETTE.ink, width: 5, join: "miter" },
});

const smallStyle = new TextStyle({
  fontFamily: RETRO_FONT,
  fontWeight: "700",
  fontSize: 14,
  fill: PALETTE.paper,
  stroke: { color: PALETTE.ink, width: 4, join: "miter" },
});

const bannerStyle = new TextStyle({
  fontFamily: RETRO_FONT,
  fontWeight: "700",
  fontSize: 34,
  fill: PALETTE.gold,
  stroke: { color: PALETTE.ink, width: 7, join: "miter" },
});

const titleStyle = new TextStyle({
  fontFamily: RETRO_FONT,
  fontWeight: "700",
  fontSize: 44,
  fill: PALETTE.gold,
  stroke: { color: PALETTE.ink, width: 9, join: "miter" },
  align: "center",
});

const subStyle = new TextStyle({
  fontFamily: RETRO_FONT,
  fontWeight: "700",
  fontSize: 16,
  fill: PALETTE.paper,
  stroke: { color: PALETTE.ink, width: 4, join: "miter" },
  align: "center",
  wordWrap: true,
  wordWrapWidth: TABLE_W - 50,
  breakWords: true,
  lineHeight: 26,
});

const COMBO_SEGMENTS = 10;

export class HUD {
  container: Container;
  private scoreText: Text;
  private stageText: Text;
  private ballsText: Text;
  private comboBarBg: Graphics;
  private comboBarFill: Graphics;
  private comboText: Text;
  private bannerText: Text;
  private bannerTimer = 0;

  titleScreen: Container;
  gameOverScreen: Container;
  private finalScoreText!: Text;
  private launchHint!: Text;

  constructor() {
    this.container = new Container();

    const topBar = new Graphics()
      .rect(0, 0, TABLE_W, 64)
      .fill({ color: PALETTE.ink, alpha: 0.92 })
      .rect(0, 62, TABLE_W, 3)
      .fill(PALETTE.gold)
      .rect(7, 5, 128, 54)
      .fill({ color: PALETTE.skyDeep, alpha: 0.9 })
      .stroke({ width: 2, color: PALETTE.blue })
      .rect(TABLE_W - 132, 5, 125, 54)
      .fill({ color: PALETTE.skyDeep, alpha: 0.9 })
      .stroke({ width: 2, color: PALETTE.blue });
    this.container.addChild(topBar);

    this.scoreText = new Text({ text: "0", style: scoreStyle });
    this.scoreText.position.set(10, 6);
    this.container.addChild(this.scoreText);

    this.stageText = new Text({ text: "STAGE 1  ▸0", style: { ...smallStyle, fontSize: 11 } });
    this.stageText.position.set(10, 34);
    this.container.addChild(this.stageText);

    this.ballsText = new Text({ text: "BALL x3", style: smallStyle });
    this.ballsText.anchor.set(1, 0);
    this.ballsText.position.set(TABLE_W - 10, 8);
    this.container.addChild(this.ballsText);

    this.comboBarBg = new Graphics();
    this.comboBarFill = new Graphics();
    this.comboBarBg.position.set(10, 30);
    this.comboBarFill.position.set(10, 30);
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
    this.container.addChild(this.titleScreen, this.gameOverScreen);
    this.gameOverScreen.visible = false;
  }

  private buildTitleScreen(): Container {
    const c = new Container();
    const bg = new Graphics()
      .rect(0, 0, TABLE_W, TABLE_H)
      .fill({ color: PALETTE.ink, alpha: 0.88 })
      .rect(10, 10, TABLE_W - 20, TABLE_H - 20)
      .stroke({ width: 3, color: PALETTE.gold, alpha: 0.6 });
    c.addChild(bg);

    const title = new Text({ text: "KAIJU\nPINBALL", style: titleStyle });
    title.anchor.set(0.5);
    title.position.set(TABLE_W / 2, TABLE_H * 0.32);
    c.addChild(title);

    const sub = new Text({
      text: "怪獣を弾いて街を破壊せよ！\n建物の数字を0にして、\n避難する人間を追いかけろ。\n\nタップで開始\n画面左右タップでフリッパー操作",
      style: subStyle,
    });
    sub.anchor.set(0.5);
    sub.position.set(TABLE_W / 2, TABLE_H * 0.55);
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
    const bg = new Graphics()
      .rect(0, 0, TABLE_W, TABLE_H)
      .fill({ color: PALETTE.ink, alpha: 0.88 })
      .rect(10, 10, TABLE_W - 20, TABLE_H - 20)
      .stroke({ width: 3, color: PALETTE.red, alpha: 0.6 });
    c.addChild(bg);

    const title = new Text({ text: "GAME OVER", style: titleStyle });
    title.anchor.set(0.5);
    title.position.set(TABLE_W / 2, TABLE_H * 0.36);
    c.addChild(title);

    this.finalScoreText = new Text({ text: "SCORE 0", style: { ...bannerStyle, fontSize: 28 } });
    this.finalScoreText.anchor.set(0.5);
    this.finalScoreText.position.set(TABLE_W / 2, TABLE_H * 0.48);
    c.addChild(this.finalScoreText);

    const prompt = new Text({ text: "TAP TO RETRY", style: { ...subStyle, fontSize: 20 } });
    prompt.anchor.set(0.5);
    prompt.position.set(TABLE_W / 2, TABLE_H * 0.6);
    c.addChild(prompt);

    return c;
  }

  showTitle() {
    this.titleScreen.visible = true;
  }

  hideTitle() {
    this.titleScreen.visible = false;
  }

  showGameOver(score: number) {
    this.finalScoreText.text = `SCORE ${score.toLocaleString()}`;
    this.gameOverScreen.visible = true;
  }

  hideGameOver() {
    this.gameOverScreen.visible = false;
  }

  setLaunchHint(visible: boolean) {
    this.launchHint.visible = visible;
  }

  setScore(score: number) {
    this.scoreText.text = score.toLocaleString();
  }

  setStage(stage: number, target: number) {
    this.stageText.text = `STAGE ${stage}  ▸${target.toLocaleString()}`;
  }

  setBalls(reserve: number, active: number) {
    this.ballsText.text = active > 1 ? `BALL x${reserve}  (${active} IN PLAY)` : `BALL x${reserve}`;
  }

  /** Drawn as a row of discrete lit/unlit blocks - a classic retro meter -
   * instead of one smoothly-filled bar. */
  setCombo(current: number, threshold: number) {
    const w = 190;
    const gap = 2;
    const segW = (w - gap * (COMBO_SEGMENTS - 1)) / COMBO_SEGMENTS;
    const lit = Math.floor(Math.min(1, current / threshold) * COMBO_SEGMENTS);

    this.comboBarBg.clear();
    this.comboBarFill.clear();
    for (let i = 0; i < COMBO_SEGMENTS; i++) {
      const x = i * (segW + gap);
      this.comboBarBg.rect(x, 0, segW, 8).fill({ color: PALETTE.ink, alpha: 0.6 });
      if (i < lit) this.comboBarFill.rect(x, 0, segW, 8).fill(PALETTE.gold);
    }
    this.comboText.text = `MULTIBALL ${current}/${threshold}`;
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
