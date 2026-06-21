# アーキテクチャ

このファイルは [CLAUDE.md](../CLAUDE.md) から読み込まれる詳細ドキュメント。

## ディレクトリ構成

```
new_claude_app/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   └── data/
│       ├── teams.json         # 出場チーム一覧
│       ├── groups.json        # グループ分け
│       ├── standings.json     # 順位表
│       ├── matches.json       # 試合（日程＋結果）
│       └── players/           # 選手データ (per-team: JPN.json / MEX.json / ...、計 48 ファイル)
└── src/
    ├── main.tsx               # エントリポイント
    ├── App.tsx                # アプリ全体のレイアウト
    ├── router.tsx             # ルーティング定義
    ├── types/                 # 型定義（メニューごとに1ファイル）
    │   ├── team.ts
    │   ├── match.ts
    │   ├── standing.ts
    │   └── player.ts
    ├── hooks/                 # データ取得フック
    │   ├── useStandings.ts
    │   ├── useMatches.ts
    │   ├── useSchedule.ts
    │   └── usePlayerStats.ts
    ├── components/
    │   ├── common/            # 全ページ共通
    │   │   ├── Header.tsx
    │   │   ├── Navigation.tsx
    │   │   ├── Footer.tsx
    │   │   └── Layout.tsx
    │   ├── standings/         # 順位表用
    │   │   ├── StandingsTable.tsx
    │   │   ├── StandingsRow.tsx
    │   │   └── GroupTabs.tsx
    │   ├── schedule/          # 日程用
    │   │   ├── ScheduleList.tsx
    │   │   ├── ScheduleDayGroup.tsx
    │   │   └── MatchCard.tsx
    │   ├── matches/           # 試合詳細用
    │   │   ├── MatchList.tsx
    │   │   ├── MatchResultCard.tsx
    │   │   ├── MatchDetail.tsx
    │   │   ├── ScoreBoard.tsx
    │   │   ├── GoalList.tsx
    │   │   └── LineUp.tsx
    │   └── stats/             # スタッツ用
    │       ├── TopScorers.tsx
    │       ├── TopAssists.tsx
    │       └── PlayerStatRow.tsx
    ├── pages/                 # ルートに対応するページ
    │   ├── HomePage.tsx
    │   ├── StandingsPage.tsx
    │   ├── SchedulePage.tsx
    │   ├── MatchesPage.tsx
    │   ├── MatchDetailPage.tsx
    │   └── StatsPage.tsx
    └── styles/
        ├── global.css
        └── variables.css
```

## ルーティング設計

| パス | ページ | コンポーネント |
|------|--------|---------------|
| `/` | トップ（メニュー導線） | `HomePage` |
| `/standings` | 順位表 | `StandingsPage` |
| `/bracket` | トーナメント表（R32〜決勝） | `BracketPage` |
| `/schedule` | 日程・結果 | `SchedulePage` |
| `/matches` | → `/schedule` リダイレクト | (`<Navigate>`) |
| `/matches/:id` | 試合詳細 | `MatchDetailPage` |
| `/teams/:id` | チーム詳細 | `TeamDetailPage` |
| `/stats` | スタッツ（得点・アシスト） | `StatsPage` |
| `/past` | 過去の大会一覧 | `PastTournamentsPage` |
| `/past/:year` | 過去の大会詳細 | `PastTournamentDetailPage` |
| `/columns` | コラム一覧 | `ColumnsPage` |
| `/columns/:id` | コラム詳細 | `ColumnDetailPage` |
| `/regulations` | 大会レギュレーション | `RegulationsPage` |
