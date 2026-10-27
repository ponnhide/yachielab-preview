# 統合CMS：Preview → Production

[統合Sheet](https://docs.google.com/spreadsheets/d/1LI4jAHL-3825jNSIznGX3cp3r7Bad-_DTiH9Pcq53j8/edit) /
[専用GAS](https://script.google.com/u/0/home/projects/1OXGZ7CPPLLYr1iYG7gUMFXUI5NuUAdHvmlKTZ5hIRK9kq1ZvN7NIQ-y8/edit)

メニュー「サイト更新」には2つだけを置く。

- **プレビュー更新**：開いているコンテンツタブを差分更新する。共有タブは全ページへ反映する。新規タブの自動登録も既存処理を使う。GitHub保存と配信完了を区別し、Google Sheets標準の確認画面に結果を表示する。
- **本番更新**：直前に保存した版がプレビューで公開済みか調べ、表示確認を求める。その固定版の**サイト全体**を本番に公開する。Sheetは読み直さず、プレビュー更新後の未反映編集は含めない。

## 公開の検証

プレビューworkflowは公開ファイル全体のSHA-256とcommit・run IDを`release.json`に記録する。本番workflowは、現在のプレビューの版、指定されたpush実行・ブランチ・workflow・配信ジョブの成功を独立に検証する。そのcommitを固定して再ビルドし、公開ファイルが1バイトでも異なれば停止する。

一致した場合のみ、プレビューのURLを本番ドメインへ変換、プレビュー専用noindexを除去、既存本番のGoogle Analytics IDを復元し、ページ更新検出用ハッシュを再計算する。コンテンツ・画像・Sheetスタイルは検証した版を使う。確認後にプレビューが変わった場合は再確認が必要になる。

本番PagesはGitHub Actionsを公開元とする。`main`へ直接ファイルを保存しても公開されない。管理者によるworkflow・Pages設定の変更まで禁止する仕組みではない。

workflowの`push`による実行と`dry_run: true`は検証のみ。本番公開は`workflow_dispatch`かつ`dry_run: false`のときだけ実施する。GASは本番リポジトリのファイルを書き換えず、この固定workflowのみを起動する。要求IDで二重送信を防ぐ。応答が不明な要求は自動再送しない。

## 接続設定

統合GASの「プロジェクトの設定 → スクリプト プロパティ」に保存する。値はコード・Sheet・チャットに書かない。

|名前|対象|必要な権限|
|---|---|---|
|`PREVIEW_GITHUB_TOKEN`|`ponnhide/yachielab-preview`のみ|Contents: Read and write。既存preview専用PATを利用可能|
|`PRODUCTION_GITHUB_TOKEN`|`yachielab/yachielab.github.io`のみ|Actions: Read and write。Contentsの書き込み権限は不要|

初回のGAS承認は、このSheetの読み書き・参照するDriveファイルの読み取り・外部API呼び出し・Sheet内UI。新たな自動トリガー権限は使用しない。

初回移行時にはGASエディタから`cmsInitializeUnifiedPreview`を実行して登録済み全ページ・共有部品をプレビューに生成し、表示確認する。ページごとに保存し、約90秒を超えたページの終了時点で中断する。同じ関数を再実行すると次のページから続行し、失敗したページは再試行する。初回生成が完了するまでは本番更新を禁止する。更新対象外のタブはそのまま保持する。次に`cmsValidateProductionConnection`を実行すると本番公開なしで接続を検証できる。両者は初期設定用で、通常メニューには追加しない。

確認画面を閉じてもGitHub側の公開は続く。配信待ちの表示は自動更新せず、次回の更新操作で再取得する。本番更新では公開前に必ずプレビューの配信成功を再検証する。本番公開済みの版は公開サイトの`release.json`まで一致した後に記録する。埋め込みHTMLパネルが空白になる環境でも結果が読めるよう標準UIを使う。

エディタ用の初期設定関数はダイアログを開かず、実行ログとSheetに結果を残す。`cmsValidateProductionConnection`を再実行すると、既存テストの進捗・結果を取得する。同じ版で成功済みのテストは重複送信しない。

## ソース同期と検証

```sh
npm run check
python3 -m unittest discover -s .github/release -p 'test_*.py'
node scripts/unified_sheet.cjs plan
node scripts/unified_sheet.cjs sync
node scripts/unified_sheet.cjs verify
```

同期先は統合GASに固定し、元のpreview・本番GASを書き換えない。`cms/unified/`は旧preview同期対象外。ソースの同期とトークン接続・実行検証は別であり、同期結果だけで運用接続済みとは扱わない。

2026-10-27のSheet統合ではpreviewの42タブをコピーし、本番のみのMILK掲載4行をsoftwareへ追加した。画像350px等のpreview調整を保持。管理タブ「公開状況」を追加し、別Sheet由来の行・画像キャッシュは初期化した。
