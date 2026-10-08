# プレビューGASの同期

編集元は `cms/` です。対象はプレビューの1プロジェクトと `codex/preview` に固定し、本番のIDやブランチを引数から指定できません。

```sh
npm ci --ignore-scripts
node scripts/gas_sync.cjs plan
node scripts/gas_sync.cjs auth
node scripts/gas_sync.cjs sync
node scripts/gas_sync.cjs verify
```

`plan` は送信予定を `private/gas-sync/plan/` に作ります。GASは変更しません。トップレベルの稼働モジュール・manifest・移行用の空ファイルだけを対象とし、`cms/legacy/`・サイトのJS・テスト・認証情報は送信しません。

初回だけ、Google Apps Script APIをGoogleのユーザー設定で有効にし、`auth` のGoogle認証を人が完了します。追加する権限は `script.projects`（Apps Scriptソースの読み書き）のみです。Googleの権限自体はアカウントのApps Scriptプロジェクトを対象にしますが、このツールの操作先はプレビュー1件に固定しています。Drive、Gmail、Cloud管理の権限は要求しません。ブラウザーから戻るURLはローカルの認証用ターミナルへ入力し、チャットやGitHubには送らないでください。

認証情報と実行前後のスナップショットはGit対象外の `private/gas-sync/` に保存します。CIやGitHub SecretsへGoogle認証情報を移す運用は行いません。

`sync` の前に変更をレビューしてコミットしてください。未コミットの変更がある場合は停止します。処理は次の順です。

1. ブランチ・remote・プレビューのSheet/リポジトリの保護定数・実行時OAuth scopeを照合。
2. `scripts/check.cjs` で全検査。失敗時はGoogleへのAPI呼び出しもしない。
3. 稼働中GASのソースを非公開のbeforeフォルダーへ取得し、保護定数とファイル構成を照合。
4. 差がある場合だけ、固定したプレビューGASへソースを送信。
5. 別フォルダーへ取得し直して全ファイルを照合。一致するまで成功と記録しない。

同期前の状態は同じ実行フォルダーの `before/` に残します。公開後にエディターで編集するとGitとの不一致が生じるため、編集をGitへ戻してから再同期してください。PropertiesServiceの保存値やインストール済みトリガーはこのソース同期の対象にしません。

生成する `BuildInfo.gs` にソース全体のハッシュとGitコミットを記録します。行HTMLキャッシュはこのソースハッシュに従うので、生成コードの変更時に手作業で版番号を上げ忘れて古いHTMLを再利用することを防ぎます。通常のコンテンツ・書式変更は従来通り行ごとに判定します。

Google認証/API設定が未完了の時点では、planとオフライン検査までが完了状態です。実際の同期は、APIからの全ファイル取得・送信後照合の成功で初めて確認できます。

参照: [Googleのclaspガイド](https://developers.google.com/apps-script/guides/clasp)、[Apps Scriptソースの取得](https://developers.google.com/apps-script/api/reference/rest/v1/projects/getContent)。
