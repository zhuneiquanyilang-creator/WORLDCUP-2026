# デプロイと開発の進め方

このファイルは [CLAUDE.md](../CLAUDE.md) から読み込まれる詳細ドキュメント。

## デプロイ (GitHub Pages)

PCの電源・回線に関係なくスマホからアクセスできるよう、GitHub Pages で公開する構成。

- **base パス**: ビルド時に `--base=/<repo>/` で注入。`.github/workflows/deploy.yml` が `github.event.repository.name` から自動設定するため、リポジトリ名を変えても編集不要。ローカル `npm run dev` は `base=/` のまま動く。
- **ルーティング**: `createHashRouter`（URL に `#` が入る）。GitHub Pages は SPA の直リンク／リロードで 404 になるため、ハッシュルーティングで回避。
- **データ取得**: `public/data/` の JSON は `utils/dataUrl.ts` の `dataUrl()` 経由で `import.meta.env.BASE_URL` を前置（サブパス配信対応）。**data ファイルの fetch は必ず `dataUrl()` を使うこと。**
- **CI/CD**: `.github/workflows/deploy.yml` が main への push で自動ビルド＆デプロイ。
- **制約**: Sofascore ライブ取得は dev サーバーのプロキシ依存のため GitHub Pages では動かない（CORS）。ライブ更新は graceful に失敗するだけ。国旗 (flagcdn) は閲覧端末のネット接続で表示される。

## スコア自動取得 (GitHub Actions)

PC が起動していない時間帯でもスコアが反映されるよう、`.github/workflows/fetch-scores.yml` が 10 分おきに Football-Data.org v4 を直接叩いて `public/data/match_results.json` を更新する。実装スクリプトは `scripts/sync-results-ci.mjs`。

- **API キー**: GitHub Secrets の `FOOTBALL_DATA_TOKEN` (リポジトリ Settings → Secrets and variables → Actions → New repository secret)。
- **API 呼び出し**: `/competitions/WC/matches` を 1 リクエストで全 104 試合まとめ取得 (無料枠 10 req/分に余裕)。
- **触るフィールド**: `status` / `score` / `penaltyScore` の 3 つだけ。`goals` / `bookings` / `substitutions` / `homeFormation` / `awayFormation` / `note` などの**手入力データは field-level merge で保護**する (`{ ...prev, ...update }`)。
- **コミット**: 差分があれば `github-actions[bot]` 名義で `public/data/match_results.json` だけを add → commit → push (他ファイルは巻き込まない)。
- **デプロイ連鎖**: `deploy.yml` 側の `workflow_run` トリガーが "Fetch live scores" の完了イベントを受けて自動デプロイする。GitHub Actions が `GITHUB_TOKEN` で push したコミットは `on: push` を発火させない仕様の対策。
- **空振り deploy の skip**: `workflow_run` は fetch-scores が commit しなくても completed で発火するため、そのままだと 10 分毎に deploy が空回りする。`deploy.yml` の `check` ジョブが `workflow_run.head_sha` (fetch-scores 開始時 HEAD) と現在の main HEAD を比較し、同じなら build/deploy を skip、違うなら実行する。push / workflow_dispatch 起因なら無条件で実行。
- **オン/オフ**: Actions タブ → "Fetch live scores" → "Disable workflow" で停止、再有効化も同じメニュー。手動実行は同画面の "Run workflow" ボタン。
- **dev サーバーの startup-catchup / auto-push との関係**: dev サーバー起動時の単発キャッチアップと AUTO_PUSH (`features.md` 参照) はそのまま並存。両者は同じ `match_results.json` を field-level merge で書き換えるので衝突しない (最終的に勝つのは最後に push した側、競合したら次回 cron で再同期される)。

## 開発の進め方

1. **CLAUDE.md（本ファイル）** ← 完了
2. プロジェクト初期化（Vite + React + TS）
3. 共通レイアウト + ナビゲーション + ルーティング
4. ダミーJSONデータ整備
5. メニュー実装の順番:
   1. 順位表
   2. 日程
   3. 試合結果・詳細
   4. スタッツ
6. スタイル調整
