# game1

WebGL Runtime Atlas + Canvas2D UI を使った軽量ピンボールプロトタイプです。ゲームオブジェクトは WebGL、HUD は Canvas2D で描画します。

## Rendering

- ゲームオブジェクトは WebGL スプライトとして描画
- スプライトは Canvas2D で実行時生成し、RuntimeAtlas に pack
- HUD は別 Canvas の Canvas2D で描画

## Install

```bash
npm install
```

## Local Development

```bash
npm run dev
```

ブラウザで表示された URL を開くと、ホットリロードつきで開発できます。

## Build

```bash
npm run check
npm run build
```

ビルド成果物は `dist/` に出力されます。

## なぜ dist/ をコミットするのか

このリポジトリは `main` ブランチ内の `dist/` をそのまま静的公開対象（GitHub Pages / 各種静的ホスティング）として使う運用を想定しています。
そのため通常の「dist を ignore する」方針ではなく、意図的に `dist/` をコミット対象にしています。

## Deploy

- `npm run build` で `dist/` を更新
- 生成された `dist/` を含めて `main` にコミット
- `dist/index.html` をエントリとして静的ホスティングに配置

`vite.config.js` では `base: './'` を使用しているため、サブディレクトリ配信でも相対パスで参照しやすくしています。

## Controls

- 左フリッパー: `←` または `A`
- 右フリッパー: `→` または `D`
- 打ち出し: `Space`（長押しでチャージ）
- リスタート: `R`
