import { Application } from "pixi.js";
import { Game } from "./game/game";
import { TABLE_W, TABLE_H } from "./physics/layout";
import "./style.css";

async function main() {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;

  const app = new Application();
  await app.init({
    canvas,
    width: TABLE_W,
    height: TABLE_H,
    backgroundColor: 0x05050a,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: true,
    powerPreference: "high-performance",
  });

  const game = new Game(app);
  if (import.meta.env.DEV) {
    (window as unknown as { __game: unknown }).__game = game.debugApi();
  }

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(w / TABLE_W, h / TABLE_H);
    const cssW = TABLE_W * scale;
    const cssH = TABLE_H * scale;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const isPhoneLandscape = w > h && h < 500;
    document.body.classList.toggle("force-landscape-hint", isPhoneLandscape);
  }

  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", layout);
  layout();
}

main();
