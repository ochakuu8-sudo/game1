# Medal Pin Game

ブラウザで動くメダルピンゲームのプロトタイプです。1ボール10メダルを投入し、盤面の鉱石ブロックを壊してメダル払い出しを得ます。

## Current Rules

- 1ボールの投入コストは10メダル
- ボール発射時に10メダルを消費
- 鉱石ブロック破壊時にメダルを払い出し
- ボール落下時に `払い出し - 10` で1ボール収支を確定
- HUDに所持メダル、直近収支、セッション収支を表示
- `U` でメダルを消費して採掘パワーを強化
- `R` でプロトタイプ状態をリセット

## Medal Economy

共通のメダル経済は `src/medalEconomy.js` に分離しています。今後スロット、レース、コインプッシャーなど別ゲームを追加する場合も、同じAPIで投入・払い出し・収支計算を扱えます。

主なAPI:

- `economy.spend(amount, source)`
- `economy.payout(amount, source)`
- `economy.completePlay({ cost, payout, source })`
- `economy.state`
- `economy.reset()`

## Controls

- 左フリッパー: `ArrowLeft` / `A`
- 右フリッパー: `ArrowRight` / `D`
- ボール発射: `Space`
- 強化: `U`
- リセット: `R`

## Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run check
npm test
npm run build
```
