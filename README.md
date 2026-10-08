# Yachie Lab preview

本番とは独立した、Yachie Lab ウェブサイトの検証環境です。

| 対象 | 設定 |
| --- | --- |
| 公開サイト | https://ponnhide.github.io/yachielab-preview/ |
| リポジトリ | `ponnhide/yachielab-preview` |
| GitHub Pages | `codex/preview` の検査・組み立て成功後に GitHub Actions から配信 |
| コピー元 | `yachielab/yachielab.github.io`、`fe9429cd9a0fee84ae23f40e33a20af708ff71fd` |
| コンテンツ | コピーした専用 Google Sheets と、その専用の Apps Script |

このリポジトリの `main` はコピー時点の保存用です。検証サイトの変更は `codex/preview` で行います。本番リポジトリ・本番 Sheets・本番 GAS・独自ドメインを更新先にしません。検証 HTML は `noindex`、Google Analytics は無効、`CNAME` は置きません。

## 編集する場所

| パス | 役割と編集方法 |
| --- | --- |
| `*.html` | 公開するページ。コンテンツと共通部品は Sheets / GAS から更新されます。手作業で直した本文は次の生成で置き換わります。 |
| `cms/` | 検証 GAS の編集元。[同期ツール](docs/gas-sync.md)が検査・送信前の保存・送信後の再取得照合を行います。初回のGoogle認証が必要です。 |
| `js/` | 表示言語、所属、ロゴの境界、メニュー、ニュースなどのブラウザ側処理。 |
| `css/` | サイトの基本レイアウトとコンポーネント。Sheets が指定する見た目との関係もここで管理します。 |
| `img/`, `img_new/`, `pdf/` | 参照のある画像・PDFと作業元。216件の原本とURLを維持し、未参照候補275件は復元可能な非公開保管へ移動しました。[整理と復元](docs/assets/maintenance.md)を参照してください。 |
| `scripts/` | 検査、資産監査、配信物の組み立て、プレビューGAS同期の開発用ツール。 |
| `docs/` | 運用手順・構造の説明・資産監査。 |

登録ページと共通部品の生成対象は、Sheets の登録と GAS で管理します。`yuka` など、現在の更新対象に含めていないページは意図的なものとして扱います。新規ページ追加と、既存ページを更新対象に入れる操作を混同しないでください。

新規ページも既存ページと同じ `Update the current page` で更新します。`template` を複製してページ名に変更し、本文を編集して更新すると、初回のHTML生成とページ登録を行います。[新規ページの手順](docs/new-pages.md)を参照してください。

## 普段の更新

1. 専用の検証 Sheets でコンテンツや対応する見た目の設定を変更します。
2. 変更したタブを選び、`Custom menu` → `Update the current page` を実行します。普段使うメニューはこの1項目です。
3. コミット先が `ponnhide/yachielab-preview` の `codex/preview` であることと、Actions の検査・配信の成功を確認します。GitHubへの保存完了と公開完了は別です。
4. 公開サイトで EN / JA / ZH、UBC / Osaka、画面幅、メニュー、ロゴ境界、ページリンクを確認します。

| 選択したタブ | `Update the current page` の更新範囲 |
| --- | --- |
| 既存の登録ページ | そのページの本文を差分更新します。 |
| 新しく追加した本文タブ | 共通レイアウトと本文を含むHTMLを初回生成し、GitHubへの保存成功後にページ登録します。 |
| header / footer / sidebar / mobilemenu | その共通部品を全登録ページとindexへ反映します。 |

一括更新・キャッシュを使わない再生成・外部データや資産の強制再取得は、保守用のGAS関数として残しています。通常メニューには表示しません。詳しくは [運用手順](docs/maintenance.md#差分更新と再取得) を参照してください。

独立ページでは空の Lab が本文の終了ですが、共通部品の空の Lab は意図したラッパー行として使います。共通部品の行をそこで打ち切ったり、整理の際に削除したりしないでください。論文著者の強調は `Member` 行の別名だけを対象とし、`Alumni` 行を自動で対象に加えません。

HTML の生成処理を直す場合は `cms/`、表示の共通ルールは `css/`、ブラウザの動作は `js/` を変更します。Sheets の値に依存する修正は、実際に Sheets → GAS → GitHub → Pages を通して確かめます。

画像の取得元と公開先の対応は、専用 Sheet の自動管理タブ `_cms_assets` で保持します。同名でも異なる取得元は、元の識別子から生成したハッシュをファイル名に加えて区別します。公開する `asset-versions.json` はローカルパスと画像・PDFの SHA だけを持ち、取得元 URL を含みません。ブラウザはこの情報を使って画像 URL の `?v=` を更新します。元の公開パスは残し、参照未確認の画像や重複ファイルの削除とは別に管理します。

通常の更新・キャッシュを使わない再生成・外部論文データの再取得では、画像だけを自動同期し、PDF は検証済みの既存ローカル版または元の外部リンクを維持します。PDF の取得も試みる場合は、保守用GAS関数 `refresh_current_assets` を使います。Drive / Dropbox PDF は16 MiB以内で対応し、出版社の外部 HTTP PDF は常にリンクを維持します。維持した件数は `pdfLinksPreserved` で通知します。詳細は [資産の運用](docs/maintenance.md#資産の取り扱い) を参照してください。

GitHub 認証には、この検証リポジトリだけに Contents の書き込みを許可したトークンを使います。専用 GAS の Script Properties に `PREVIEW_GITHUB_TOKEN` として保存します。トークンをソース、Sheet、コミット、ログに入れません。`cms/PreviewIsolation.gs` がコピーした Sheet・リポジトリ・ブランチ・書き込みパスを確認します。GAS にソースを反映するときは、この保護コードも一緒に維持してください。

GAS はメニュー、Sheet の読み取り、HTML 生成、見た目設定、論文データ、資産取得、GitHub への保存に分けています。外部 GAS ライブラリは Cheerio 14 のみです。未使用の Parser / cUseful は外し、Google 権限は現在の Sheet、Drive の読み取り、外部通信、コンテナ UI に明示的に限定しています。詳細とモジュール一覧は [運用手順](docs/maintenance.md) を参照してください。

## ローカルで確認する

全検査は Node 24 LTS と Python で実行します。依存定義はlockfileに固定しています。[自動検査と公開](docs/ci.md)を参照してください。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
node scripts/asset_maintenance.cjs --check
node scripts/build_site.cjs --output dist/site
```

配信物には公開ページ・CSS・JS・資産だけを含めます。人物写真などの表示用軽量版をビルドで生成し、元画像のダウンロード先は維持します。`cms/`、`docs/`、テスト、認証情報、非公開保管物は配信しません。ビルド先は空の `dist/site` が必要です。

資産監査だけなら Python 3.9 以降の標準ライブラリで実行できます。

```sh
python3 scripts/test_site_audit.py
python3 scripts/site_audit.py --check
python3 scripts/site_audit.py --output docs/assets/manifest.json --markdown docs/assets/README.md --catalogue docs/assets/catalogue.md
```

Sheet の保存データも資産参照の調査に含める場合は、リポジトリ外に置いた JSON を指定します。レポートに Sheet のセル内容は出力しません。

```sh
python3 scripts/site_audit.py --sheet-data /private/tmp/yachielab-preview-sheet-source.json --output docs/assets/manifest.json --markdown docs/assets/README.md --catalogue docs/assets/catalogue.md
```

検査は HTML / CSS / JS / GAS のローカル参照、画像・PDF の実体、同一ファイル、トークンらしい文字列、プレビューの本番リンク・Analytics・`noindex`・`CNAME` を確認します。外部サイトの死活、ブラウザのレイアウト、実際の GAS 認証は別途確認が必要です。

ローカルで画像を追加・上書きした場合は `node scripts/version_assets.cjs` で変更予定を確認し、`node scripts/version_assets.cjs --write` でバージョン情報と HTML の資産 URL を更新します。後者は `codex/preview` に限定し、画像の削除・移動やコミット・公開は行いません。詳しくは [資産の運用](docs/maintenance.md#資産の取り扱い) を参照してください。

資産一覧は、公開 HTML から辿れる CSS / JS を含む参照、入力・ソースだけの参照、参照未確認に分類します。実際に画面へ表示された回数や外部からの直リンクを調べた結果ではありません。Sheet の参照調査には最新の書き出しを指定してください。ハッシュ付きファイル名と `?v=` のある URL も、対象の実ファイルを確認します。

ローカルの配信には `python3 -m http.server 8000` を使えます。GitHub Pages の `/yachielab-preview/` というパスでの確認も行ってください。Pages に必要な `.nojekyll` を維持します。

詳しい手順は [運用・構造](docs/maintenance.md)、表示ルールは [CSS の構造](css/README.md)、画像・PDF の状況は [資産監査](docs/assets/README.md)、確認した範囲は [検証記録](docs/verification.md) を参照してください。
