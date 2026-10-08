# 画像・PDF の資産監査

このファイルは `scripts/site_audit.py --markdown docs/assets/README.md` で生成します。個別のパス・SHA-256・参照証拠・重複は [manifest.json](manifest.json)、用途別の全件一覧は [catalogue.md](catalogue.md) に保存しています。

## 範囲と結果

HTML / CSS / JS / GAS のローカルソースを確認しました。ファイル名の動的組み立てやコメントも保守的に参照証拠へ含めるため、参照数は実行時の使用数とは一致しません。外部からの直接リンクは確認できていません。

| 項目 | 結果 |
| --- | --- |
| 画像・PDF のファイル | 216 |
| 総容量 | 367.4 MiB |
| 参照証拠あり | 216 |
| 公開ページから辿れる参照 | 179 |
| 入力・ソースだけの参照 | 37 |
| 参照証拠なしの確認候補 | 0 |
| 候補の容量 | 0.0 MiB |
| SHA-256 が同一のグループ | 10 |
| Sheet JSON の入力ファイル | 1 |
| 入力された Sheet のタブ | 38 |
| 具体的な検査エラー | 0 |

**確認候補は削除候補の確定ではありません。** Sheet、生成処理、組み立てた URL、過去の公開資料、外部リンクの確認が必要です。preview での保管先変更と復元情報は [整理記録](maintenance.md) を確認してください。公開ページから辿れる参照も、画面上での表示や利用回数を測定したものではありません。Sheet は指定された書き出し時点の内容だけを確認しています。

## ディレクトリ別の画像数

画像数は拡張子を基準とし、HEIC や形式不一致のファイルも含みます。PDF や作業元を含む全ファイル数と区別します。

| ディレクトリ | 全ファイル | 画像拡張子 | 画像の参照証拠あり | 画像の参照未確認 |
| --- | ---: | ---: | ---: | ---: |
| `img/` | 155 | 155 | 155 | 0 |
| `img_new/` | 4 | 4 | 4 | 0 |
| `pdf/` | 57 | 0 | 0 | 0 |

## 作業元のファイル

現在の公開ディレクトリにある、ブラウザ向け配信物以外の形式を個別に記録します。退避した作業元は archive-manifest.json を確認してください。


## 形式が一致しないファイル

画像拡張子なのに HTML になっているものなどを記録します。未参照のファイルは公開表示の不具合と断定しません。

- `img/navy_yachielablogo2.svg`: 拡張子から期待する形式 `svg`、実体 `html`

## 容量の大きい確認候補

上位 20 件です。全件の一覧は manifest.json の `status: review-candidate` を参照してください。

| パス | MiB |
| --- | ---: |

## 参照が見つからない CSS

HTML / JS の静的参照を基準にしています。旧資料や外部利用を確認してから整理してください。

- `css/common_01222024.css`
- `css/index_new.css`
- `css/joinus.css`
- `css/resources.css`

## 再生成

Sheet の入力を含める場合は、非公開の JSON をリポジトリ外に置きます。セルの内容はレポートに保存しません。

```sh
python3 scripts/site_audit.py --sheet-data /private/tmp/yachielab-preview-sheet-source.json --output docs/assets/manifest.json --markdown docs/assets/README.md --catalogue docs/assets/catalogue.md
```

`--check` は欠落したローカルファイル、参照中の HTML 実体画像、機密情報らしい文字列、プレビューの公開設定などの具体的エラーで失敗します。重複ファイル・参照候補・重複 ID は別途レビューできる警告です。
