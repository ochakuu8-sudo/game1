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

export class HUD {
  container: Container;
  private scoreText: Text;
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
      .rect(0, 0, TABLE_W, 48).fill({ color: 0x071219, alpha: 0.9 })
      .rect(0, 46, TABLE_W, 2).fill({ color: 0x68d7e8, alpha: 0.55 })
      .roundRect(7, 5, 128, 35, 8).fill({ color: 0x17303c, alpha: 0.9 }).stroke({ width: 1, color: 0x68d7e8, alpha: 0.4 })
      .roundRect(TABLE_W - 132, 5, 125, 35, 8).fill({ color: 0x17303c, alpha: 0.9 }).stroke({ width: 1, color: 0x68d7e8, alpha: 0.4 });
    this.container.addChild(topBar);

    this.scoreText = new Text({ text: "0", style: scoreStyle });
    this.scoreText.position.set(10, 6);
    this.container.addChild(this.scoreText);

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
    const bg = new Graphics().rect(0, 0, TABLE_W, TABLE_H).fill({ color: 0x05050a, alpha: 0.86 });
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
    const bg = new Graphics().rect(0, 0, TABLE_W, TABLE_H).fill({ color: 0x05050a, alpha: 0.86 });
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

  setBalls(reserve: number, active: number) {
    this.ballsText.text = active > 1 ? `BALL x${reserve}  (${active} IN PLAY)` : `BALL x${reserve}`;
  }

  setCombo(current: number, threshold: number) {
    const w = 190;
    const t = Math.min(1, current / threshold);
    this.comboBarBg.clear().roundRect(0, 0, w, 8, 4).fill({ color: 0xffffff, alpha: 0.15 });
    this.comboBarFill.clear();
    if (t > 0) this.comboBarFill.roundRect(0, 0, Math.max(8, w * t), 8, 4).fill(0xff5a3c);
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
