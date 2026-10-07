# ふわりフォト

淡いピンクと水色の、個人用の写真共有サイトです。
画面：GitHub Pages ／ 保存API：Cloudflare Workers ／ 永続保存：非公開Cloudflare R2。

## できること

- スマホ・PCからJPEG / PNG / WebPを1〜4枚選択（1枚8MBまで）
- 投稿前プレビュー、個別の取り消し、PCのドラッグ＆ドロップ
- 投稿専用URLの発行・コピー、ログイン不要の閲覧、写真の拡大
- 管理パスワードで投稿・削除。閲覧者はパスワード不要
- API秘密鍵はフロントエンドに置かず、R2へのアクセスはWorkerのbindingで実施

## 最初に：まだ公開済みではありません

このファイル一式は実装済みのソースです。GitHub / Cloudflare のアカウント設定とデプロイ後に、他の端末から写真を共有できます。`config.js`が未設定でも写真の選択・プレビューを試せますが、保存や共有URL発行はできません。ローカル保存を永続共有と見せかけるデモではありません。

必要なもの：GitHubアカウント、Cloudflareアカウント、Node.js 22以降。
R2には無料枠がありますが、利用開始時に支払い方法登録を求められる場合があります。無料枠超過は従量課金で、ずっと無料の保証ではありません。Cloudflareの予算通知を設定し、R2の使用量を確認してください。

## 公開手順

### 1. GitHubリポジトリを用意

GitHubで公開リポジトリ `photo` を作ります。このフォルダ内の内容をリポジトリ直下に置きます（`docs`・`backend`・`.github` が直下に来る形）。GitHub Desktopを使っても構いません。

GitHubのリポジトリ → Settings → Pages → Build and deployment → Source を **GitHub Actions** にします。

### 2. 保存先とWorkerを用意

Cloudflareの管理画面でR2を有効化します。バケットの公開アクセス（r2.dev・カスタムドメイン）は有効化しないでください。
ターミナルでこのプロジェクトの `backend` に移動して実行します。

```sh
npm install
npx wrangler login
npx wrangler r2 bucket create soft-photo-share
```

`backend/wrangler.toml` の `ALLOWED_ORIGIN` を、自分のGitHub Pagesの**オリジンだけ**に変更してください。末尾のスラッシュや `/photo` は含みません。

```toml
ALLOWED_ORIGIN = "https://自分のGitHubユーザー名.github.io"
```

バケット名を変えた場合は `bucket_name` も合わせます。Workerを公開します。

```sh
npx wrangler deploy
npx wrangler secret put OWNER_PASSWORD
```

最後のコマンドで、自分で決めたランダムな管理パスワードを入力します。**20文字以上必須**です。パスワード管理アプリで生成・保管するのがおすすめです。ソース・README・GitHub・config.jsへは書き込みません。設定完了前は投稿・削除が拒否されます。

### 3. 画面にAPIの場所を設定

`docs/config.js` の `apiBase` に、デプロイで表示されたWorkerのURLを設定します。

```js
window.PHOTO_CONFIG = {
  apiBase: "https://soft-photo-api.自分のサブドメイン.workers.dev"
};
```

これは公開用の接続先であり、APIキーではありません。このURLに `/posts` は付けません。
変更したファイルをGitHubの `main` ブランチへpushすると、同梱のActionsで `docs` がGitHub Pagesへ公開されます。
Actionsタブで成功を確認し、Settings → Pages に表示されるURLを開きます。

### 4. 投稿する

1. 写真を1〜4枚選んでプレビューを確認。
2. 「投稿・削除用の管理パスワード」を開き、パスワードを入力。
3. 「写真をアップロード」→「URLをコピー」。
4. ニコッとタウンの日記へ貼り付け。

共有URLの形式は `https://自分の名前.github.io/photo/?post=ランダムな投稿ID` です。GitHub Pagesでは動的なパスをサーバーで扱えないため、直接アクセスや再読み込みでも404にならないクエリ形式を採用しています。

削除は共有URLを開き、「投稿者の管理」からパスワードを入力して実行します。異なる端末からでも可能です。管理パスワードは全投稿に共通です。写真を削除すると共有URLは無効になりますが、他人がダウンロードしたコピーまでは削除できません。

## ローカル確認

プロジェクト直下で：

```sh
npm run preview
npm test
```

`http://localhost:8080` を開きます。バックエンドもローカル確認する場合は、`backend/.dev.vars` を自分で作って `OWNER_PASSWORD` を設定します（Git管理対象外）。ローカル用に `ALLOWED_ORIGIN` を `http://localhost:8080` に変更して `npm run dev`、フロントの `apiBase` を `http://localhost:8787` にします。公開時は両方を本番値に戻してください。

## 保存とセキュリティの仕様

R2に `photos/投稿ID/番号` と `posts/投稿ID` を保存します。投稿一覧APIはなく、ランダムな128bitの投稿IDで共有します。管理パスワードはブラウザのメモリにのみ保持し、localStorageやURLには保存しません。画面を再読み込みしたら再入力してください。

投稿・削除はWorker側でパスワード確認を行います。CORSは指定したGitHub Pagesオリジンだけを許可します。ただしCORS自体は認証ではありません。認証のない書き込みはサーバーで拒否します。POSTの全体容量、枚数、MIME型、JPEG/PNG/WebPの先頭バイトを検査し、SVG・HTML・動画は受け付けません。フロントでは画像のデコードも確認します。バックエンドの検査は完全な画像デコーダではありませんが、公開コンテンツのContent-Typeを固定しnosniffを付与しています。

GETはログイン不要です。写真はR2を直接公開せずWorkerで配信し、投稿の存在を毎回確認します。レスポンスはno-storeです。削除には所有者パスワードが必要です。

現在の実装は原本を保存します。位置情報などEXIFを自動除去しません。顔・住所・位置情報を共有したくない写真は、投稿前に端末側で加工・位置情報を除去してください。リンクを知る人は誰でも閲覧できます。閲覧用パスワードや公開一覧はありません。

個人の小規模利用向けです。専用のログイン画面、ユーザー登録、パスワード試行回数制限、画像変換、HEIC変換、投稿一覧は未実装です。管理パスワードを十分長くし、Cloudflare側で必要に応じてレート制限を設定してください。ストレージが満杯・通信不良のときはエラーを表示します。アップロード途中の通常エラーでは保存済み写真を削除しますが、実行強制終了や削除サービス障害では孤立オブジェクトが残る可能性があります。R2の管理画面で不要なオブジェクトを確認・削除できます。

## 公式資料

- GitHub Pages: https://docs.github.com/en/pages
- R2の使い始め: https://developers.cloudflare.com/r2/get-started/
- R2料金: https://developers.cloudflare.com/r2/pricing/
- Workerの秘密情報: https://developers.cloudflare.com/workers/configuration/secrets/

## 検証

`npm test` はメモリ上のR2代替を使って、4枚投稿→公開取得→本人削除、誤ったパスワード、異なるOrigin、0枚/5枚、不正形式、8MB超過、途中失敗の掃除、CORS preflightを検証します。本番アカウント上の保存・課金・GitHub Actionsの実行は、設定後に別途確認してください。
