# preview の自動検査

ローカルと GitHub Actions は同じ入口を使います。推奨環境は Node 24 LTS と Python 3.13 です。CMS / JS テストには標準ライブラリの模擬環境と、生成HTMLを実解析する固定版Cheerio 1.2.0を使います。Python の監査は標準ライブラリだけで実行します。画像検証ツール用に Sharp 0.35.4 を開発依存として用意します。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

`package-lock.json` を保存し、`npm ci` で依存定義との一致を確認します。GAS ソース同期用の CLI `@google/clasp` を3.4.1、画像検証用の `sharp` を0.35.4に固定し、その間接依存も lockfile で固定します。検査実行時には clasp の認証や GAS への接続は行いません。Python を別の実行ファイルで使う場合は、`PYTHON=/絶対パス/python3 npm run check` とします。

| コマンド | 検査 |
| --- | --- |
| `npm test` | `tests/` 内の全 `.test.cjs` / `.test.mjs`。CMS生成、通信・隔離、キャッシュ、画像同期、URL版管理、ハッシュ、JSの動作、検査入口の失敗時動作。 |
| `npm run test:python` | 資産監査ツールの回帰テスト。 |
| `npm run check:css` | CSS の import、公開 URL、ロゴ配置と共通部品の構造。 |
| `npm run check:audit` | 公開ファイルのローカル参照・機密情報らしい文字列・画像実体・preview 設定。 |
| `npm run check` | 上記すべて。いずれかが失敗・中断・実行不能なら終了コード1。 |

新しいテストファイルも自動で検出します。CMS または JS テストがなくなった場合は、成功と扱わず停止します。`node scripts/check.cjs --list` で実行予定の一覧を確認できます。入口はリポジトリの場所を基準に動くため、現在の作業ディレクトリに依存しません。検査の名前と結果はそのまま表示し、独立した検査は前の失敗後も実行します。監査一覧の再生成や `version_assets.cjs --write` は検査コマンドに含めません。

## GitHub Actions

`.github/workflows/checks.yml` は `ponnhide/yachielab-preview` に限定して、次の場合に実行します。

- `codex/preview` への push。GAS が生成 HTML を保存したコミットも対象です。
- `codex/preview` を変更先とする pull request。

Node 24、Python 3.13 と `npm ci` を使って全検査を実行します。その後、画像整理の記録を検証し、配信用のファイルだけを `dist/site` へ組み立てます。これらのどれかが失敗すると artifact は配信されません。PR でも組み立てまで確認しますが、artifact の配信は preview ブランチへの push だけです。

```sh
node scripts/asset_maintenance.cjs --check
node scripts/build_site.cjs --output dist/site
```

公開する artifact は HTML / CSS / JS / 画像 / PDF と公開設定の一覧を対象とし、`cms/`、`tests/`、`docs/`、開発用ツール、認証情報、private archive を含めません。画像の軽量化用ファイルと対応表も、組み立て時に検証します。

公式 Actions は確認した commit SHA に固定します。検査・組み立て job は `contents: read` だけで、checkout の認証情報を保存しません。配信 job だけに Pages 配信に必要な `pages: write` と `id-token: write` を与えます。Google・GitHubの個人トークン、private Sheet JSON、GAS本体への接続は不要です。CI は GAS ソースを送信しません。

## 公開との関係

配信 job は `needs: checks` とし、同じ commit の検査・組み立て・artifact upload がすべて成功した場合だけ進みます。対象は `ponnhide/yachielab-preview` の `codex/preview` への push に固定し、PR は配信しません。配信先の environment は `github-pages` です。進行中の配信は新しい push で中断せず、新しい変更を順番に確認します。

この仕組みを有効にするには、preview リポジトリの Settings → Pages → Source を **GitHub Actions** に設定します。ブランチからの自動配信が残っている間は、検査前に配信される従来の経路も残るため、この停止条件は完成していません。workflow は配信方式を自動変更せず、導入時に設定と実行結果を確認します。本番の Pages 設定は変更しません。

GAS の GitHub 保存完了と Pages 配信完了は別です。失敗した commit はリポジトリに保存されても配信されず、サイトには直前の成功した artifact が残ります。Actions の検査結果を確認して修正してください。コード変更は PR の検査で確認し、GAS に反映する前にも同じローカル検査を実行します。GAS が直接書き込む現ブランチへ一律に PR 必須の保護を設定すると通常の Sheet 更新を遮断するので、そのまま適用しません。

CI は静的検査とサービスを模擬した回帰検査です。実際のブラウザ配置、Googleの認証、外部リンクの死活、Sheetからのライブ更新とPagesへの反映は別に確認します。

参考: [Node の公式リリース](https://nodejs.org/en/about/previous-releases)、[npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)、[GitHub Actions の実行条件](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[Pages の検査・組み立てと配信 job の接続](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
