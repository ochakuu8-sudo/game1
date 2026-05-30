# Medal Pin Game

ブラウザで動くメダルピンゲームのプロトタイプです。1ボール10メダルを投入し、盤面に描かれた街の建物を壊します。建物から出てきた人をボールで潰すと1ポイントとして1メダルを払い出します。街はピクセルブロックの集合ではなく、Canvas2Dで建物単位に描画します。

## Current Rules

- 1ボールの投入コストは10メダル
- ボール発射時に10メダルを消費
- 盤面は1枚の街マップ
- 小さい内部グリッド上に、サイズの異なる建物を配置
- 建物はCanvas2Dの矩形、屋根、窓、看板で描画
- 建物を破壊すると人が出現
- 人をボールで潰すと1ポイント、1メダルを払い出し
- ボール落下時に `払い出し - 10` で1ボール収支を確定
- HUDに所持メダル、直近収支、セッション収支を表示
- 右側のボール発射レーンはなし
- フリッパー操作でボール開始
- `U` でメダルを消費して破壊パワーを強化
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
- ボール発射: 左右フリッパー操作
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
