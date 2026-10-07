# Yachie Lab preview

本番とは独立した、Yachie Lab ウェブサイトの検証環境です。

| 対象 | 設定 |
| --- | --- |
| 公開サイト | https://ponnhide.github.io/yachielab-preview/ |
| リポジトリ | `ponnhide/yachielab-preview` |
| GitHub Pages | `codex/preview` ブランチ、リポジトリ直下 |
| コピー元 | `yachielab/yachielab.github.io`、`fe9429cd9a0fee84ae23f40e33a20af708ff71fd` |
| コンテンツ | コピーした専用 Google Sheets と、その専用の Apps Script |

このリポジトリの `main` はコピー時点の保存用です。検証サイトの変更は `codex/preview` で行います。本番リポジトリ・本番 Sheets・本番 GAS・独自ドメインを更新先にしません。検証 HTML は `noindex`、Google Analytics は無効、`CNAME` は置きません。

## 編集する場所

| パス | 役割と編集方法 |
| --- | --- |
| `*.html` | 公開するページ。コンテンツと共通部品は Sheets / GAS から更新されます。手作業で直した本文は次の生成で置き換わります。 |
| `cms/` | 検証 GAS の編集元。Git で差分を確認してから専用 GAS に反映します。認証情報は含めません。 |
| `js/` | 表示言語、所属、ロゴの境界、メニュー、ニュースなどのブラウザ側処理。 |
| `css/` | サイトの基本レイアウトとコンポーネント。Sheets が指定する見た目との関係もここで管理します。 |
| `img/`, `img_new/`, `pdf/` | 配信する画像・PDFと作業元。既存の公開 URL を維持し、参照未確認のファイルも削除・移動しません。[参照一覧](docs/assets/catalogue.md)で確認します。 |
| `scripts/` | オフライン検査と資産一覧を生成する開発用ツール。 |
| `docs/` | 運用手順・構造の説明・資産監査。 |

登録ページと共通部品の生成対象は、Sheets の登録と GAS で管理します。`yuka` など、現在の更新対象に含めていないページは意図的なものとして扱います。新規ページ追加と、既存ページを更新対象に入れる操作を混同しないでください。

## 普段の更新

1. 専用の検証 Sheets でコンテンツや対応する見た目の設定を変更します。
2. 専用 GAS / Sheets メニューから対象ページまたは共通部品を更新します。
3. コミット先が `ponnhide/yachielab-preview` の `codex/preview` であることと、Pages の公開結果を確認します。
4. 公開サイトで EN / JA / ZH、UBC / Osaka、画面幅、メニュー、ロゴ境界、ページリンクを確認します。

| メニュー | 更新範囲 |
| --- | --- |
| `Update the current page` | 選択した登録ページの本文。共通部品タブを選択している場合は、その部品を21ページへ反映。 |
| `Update shared components` | header / footer / sidebar / mobile menu を、index を含む21ページへ1コミットで反映。各ページの本文は維持。 |
| `Update all registered pages` | 登録された20ページの本文を1コミットで更新。index の共通部品には上のメニューを使用。 |
| `Refresh linked assets on current page` | 選択ページが参照する外部・Drive 資産を強制的に取得し直します。通常更新でも変更を確認します。形式と16 MiB上限を検査し、対象外・上限超過の PDF はリンクを維持して件数を通知します。 |

独立ページでは空の Lab が本文の終了ですが、共通部品の空の Lab は意図したラッパー行として使います。共通部品の行をそこで打ち切ったり、整理の際に削除したりしないでください。論文著者の強調は `Member` 行の別名だけを対象とし、`Alumni` 行を自動で対象に加えません。

HTML の生成処理を直す場合は `cms/`、表示の共通ルールは `css/`、ブラウザの動作は `js/` を変更します。Sheets の値に依存する修正は、実際に Sheets → GAS → GitHub → Pages を通して確かめます。

画像の取得元と公開先の対応は、専用 Sheet の自動管理タブ `_cms_assets` で保持します。同名でも異なる取得元は、元の識別子から生成したハッシュをファイル名に加えて区別します。公開する `asset-versions.json` はローカルパスと画像・PDFの SHA だけを持ち、取得元 URL を含みません。ブラウザはこの情報を使って画像 URL の `?v=` を更新します。元の公開パスは残し、参照未確認の画像や重複ファイルの削除とは別に管理します。

出版社などの外部 HTTP PDF と、16 MiBを超える Drive / Dropbox PDF は自動同期を省略します。検証済みの既存ローカル PDF があればそれを維持し、なければ元の外部リンクを使い、省略した件数を通知します。上限内の Drive / Dropbox PDF は同期します。大きな PDF だけを理由に画像やページの更新を止めません。詳細は [資産の運用](docs/maintenance.md#資産の取り扱い) を参照してください。

GitHub 認証には、この検証リポジトリだけに Contents の書き込みを許可したトークンを使います。専用 GAS の Script Properties に `PREVIEW_GITHUB_TOKEN` として保存します。トークンをソース、Sheet、コミット、ログに入れません。`cms/PreviewIsolation.gs` がコピーした Sheet・リポジトリ・ブランチ・書き込みパスを確認します。GAS にソースを反映するときは、この保護コードも一緒に維持してください。

GAS はメニュー、Sheet の読み取り、HTML 生成、見た目設定、論文データ、資産取得、GitHub への保存に分けています。外部 GAS ライブラリは Cheerio 14 のみです。未使用の Parser / cUseful は外し、Google 権限は現在の Sheet、Drive の読み取り、外部通信、コンテナ UI に明示的に限定しています。詳細とモジュール一覧は [運用手順](docs/maintenance.md) を参照してください。

## ローカルで確認する

Python 3.9 以降の標準ライブラリだけで検査できます。追加パッケージは不要です。

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
