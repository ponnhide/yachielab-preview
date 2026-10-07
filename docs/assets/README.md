# 画像・PDF の資産監査

このファイルは `scripts/site_audit.py --markdown docs/assets/README.md` で生成します。個別のパス・SHA-256・参照証拠・重複は [manifest.json](manifest.json) に保存しています。

## 範囲と結果

HTML / CSS / JS / GAS のローカルソースを確認しました。ファイル名の動的組み立てやコメントも保守的に参照証拠へ含めるため、参照数は実行時の使用数とは一致しません。外部からの直接リンクは確認できていません。

| 項目 | 結果 |
| --- | --- |
| 画像・PDF のファイル | 480 |
| 総容量 | 579.3 MiB |
| 参照証拠あり | 209 |
| 参照証拠なしの確認候補 | 271 |
| 候補の容量 | 217.3 MiB |
| SHA-256 が同一のグループ | 64 |
| Sheet JSON の入力ファイル | 1 |
| 入力された Sheet のタブ | 38 |
| 具体的な検査エラー | 0 |

**確認候補は削除候補の確定ではありません。** Sheet、生成処理、組み立てた URL、過去の公開資料、外部リンクの確認が必要です。この整理では既存の画像・PDF を削除・移動していません。

## 作業元のファイル

ブラウザ向け配信物以外の形式を個別に記録します。元の公開パスは維持しています。

- `img/IMG_1416.HEIC` (1.7 MiB)
- `img/gray_yachielablogo.afdesign` (0.0 MiB)
- `img/logo_research_w.afdesign` (0.0 MiB)

## 形式が一致しないファイル

画像拡張子なのに HTML になっているものなどを記録します。未参照のファイルは公開表示の不具合と断定しません。

- `img/Picture_Madhu_Rangesa.jpeg`: 拡張子から期待する形式 `jpeg`、実体 `html`
- `img/navy_yachielablogo2.svg`: 拡張子から期待する形式 `svg`、実体 `html`

## 容量の大きい確認候補

上位 20 件です。全件の一覧は manifest.json の `status: review-candidate` を参照してください。

| パス | MiB |
| --- | ---: |
| `img/top-image.jpg` | 19.4 |
| `img/■清書.jpg` | 19.4 |
| `pdf/Pooled CRISPR screening of high-content...lular phenotypes using ghost cytometry.pdf` | 14.4 |
| `img/IMG_1691-copy.jpg` | 8.4 |
| `img/生物物理海外だより (2).pdf` | 7.9 |
| `img/background.jpg` | 5.8 |
| `img/BG.png` | 4.8 |
| `pdf/2023.01.26.525784v1.full.pdf` | 4.7 |
| `img/位置参考.png` | 4.4 |
| `img_new/位置参考.png` | 4.4 |
| `img_new/_BG.png` | 3.9 |
| `img/cover_ol3.png` | 3.7 |
| `img/Osaka_top.jpg` | 3.2 |
| `img/DSC_0530.jpg` | 3.2 |
| `img/dji_fly_20240530_103042_838_1717090252846_photo_optimized.JPG` | 3.2 |
| `img/Chengyu2.jpg` | 2.9 |
| `img/osaka-group-March-2024.jpg` | 2.9 |
| `pdf/Advanced Optical Materials - 2023 - Kawasaki - Computational Design of Synthetic Optical Barcodes in Microdroplets.pdf` | 2.7 |
| `pdf/2023.12.10.570953v1.full.pdf` | 2.4 |
| `pdf/2022.08.04.502727v1.full.pdf` | 2.3 |

## 参照が見つからない CSS

HTML / JS の静的参照を基準にしています。旧資料や外部利用を確認してから整理してください。

- `css/common_01222024.css`
- `css/index_new.css`
- `css/joinus.css`
- `css/resources.css`

## 再生成

Sheet の入力を含める場合は、非公開の JSON をリポジトリ外に置きます。セルの内容はレポートに保存しません。

```sh
python3 scripts/site_audit.py --sheet-data /private/tmp/yachielab-preview-sheet-source.json --output docs/assets/manifest.json --markdown docs/assets/README.md
```

`--check` は欠落したローカルファイル、参照中の HTML 実体画像、機密情報らしい文字列、プレビューの公開設定などの具体的エラーで失敗します。重複ファイル・参照候補・重複 ID は別途レビューできる警告です。
