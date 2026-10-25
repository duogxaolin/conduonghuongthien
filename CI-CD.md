# 🔄 CI/CD Tự Động (GitHub Actions → GHCR → VPS)

Tài liệu vận hành cho việc triển khai tự động. Phần cài đặt VPS lần đầu (Docker,
`.env`, khởi tạo CSDL, sao lưu) nằm ở [DEPLOY.md](./DEPLOY.md).

---

## Luồng chạy

```
push main → Plan (deploy=false nếu MỌI tệp đổi TỪ BẢN ĐANG CHẠY trên production là *.md / docs/ / openspec/)
          → test · typecheck · build · hygiene   (4 cổng, chạy song song, kể cả lượt chỉ-tài-liệu)
              ↓ cả bốn xanh, và deploy=true
            job "image"  → xây rồi đẩy ghcr.io/<owner>/<repo>:sha-<commit> + :latest
                           (APP_VERSION = 12 ký tự đầu của SHA, nướng vào image)
              ↓
            job "deploy" → ssh: gửi docker-compose.yml + scripts/backup-db.sh của commit này (kèm SHA-256)
                         → ssh: deploy-remote.sh → kiểm SHA-256 → docker pull
                         → dump CSDL .deploy-db-backups/cdkt-predeploy-* (đã kiểm; hỏng → dừng, chưa chạm gì)
                         → sao lưu compose cũ → đặt compose mới → docker compose config -q
                           (sai → trả bản cũ, dừng, không chạm container)
                         → đổi CDKT_IMAGE trong .env → up -d --no-deps app
                         → chờ HEALTHCHECK (crash loop > 2 lần khởi động lại → dừng chờ ngay)
                           → hỏng thì tự lùi về image + compose trước
                         → khoẻ: dọn image sha-* cũ (giữ đang chạy + 5), cảnh báo đĩa > 80 %
                       → smoke: GET <VPS_SMOKE_URL>/api/public/health phải trả đúng version mới
```

**Một lượt deploy đang chạy không bao giờ bị huỷ giữa chừng.** `concurrency` ở đầu
`ci.yml` chỉ huỷ lượt cũ với **pull request** (`cancel-in-progress: ${{ github.event_name
== 'pull_request' }}`). Push vào `main` thì xếp hàng: GitHub giữ một lượt chờ và chỉ
huỷ những lượt còn *đang chờ* cũ hơn. Trước đây giá trị là `true` trơn — huỷ ở cấp
workflow là huỷ CẢ lượt chạy, kể cả job `deploy` đang chờ healthcheck (nhóm
`deploy-production` riêng của job không che được), nên một push thứ hai trong cửa sổ
deploy cắt phiên SSH: đường lùi không chạy, production nằm trên image chưa xác nhận.
Cái giá: hai lần merge sát nhau thì lượt sau chờ lượt trước chạy xong (~40 phút).

**Vì sao xây ở CI chứ không `git pull && docker compose build` trên VPS:** `nuxi build`
ngốn RAM, và trên VPS 1–2 GB nó bị OOM-kill giữa chừng — đúng lúc container cũ đã
dừng. Xây ở nơi khác thì một lần build hỏng **không chạm được** vào trang đang chạy,
và lùi phiên bản chỉ là trỏ lại tag cũ thay vì xây lại từ đầu.

**Vì sao hai job deploy nằm chung workflow với bốn cổng kiểm tra** (thay vì một
`workflow_run` riêng): để `needs: [test, typecheck, build, hygiene]` là một ràng buộc
của đồ thị phụ thuộc chứ không phải một lời hứa. Không có commit nào đi ra VPS mà
chưa qua đủ bốn cổng.

**Tiết kiệm phút Actions** (hạn mức 3.000 phút/tháng chỉ áp cho repo private — repo này hiện
**PUBLIC** (kiểm bằng `gh repo view --json visibility` ngày 2026-10-23), nên phút Actions
không bị giới hạn; ghi chú ngày 2026-10-22 nói repo đã sang private là sai. Giữ các quy tắc dưới
đây vẫn đáng: chúng rút ngắn thời gian chờ CI, và áp lại ngay nếu repo chuyển private —
tài khoản từng hết phút khi còn private): một lượt CI đầy đủ ≈ 40 phút
billed (GitHub làm tròn từng job lên phút; các job Integration chiếm ≈ 29 khi còn 13 job; nay matrix 22). Nên job
`changes` ("Plan") quyết định cho mỗi lượt chạy:

| Sự kiện | Chạy gì |
|---|---|
| push vào `main`, chạy tay (Actions → CI → Run workflow) | **Đủ bộ**, gồm Integration — `image`/`deploy` vẫn chờ mọi cổng |
| push vào `main` mà **mọi** tệp đổi **từ commit đang chạy trên production** khớp `\.md$\|^docs/\|^openspec/` | Đủ bộ test, nhưng **không** build image, **không** deploy (`changes.outputs.deploy=false`; không xác định được bản đang chạy → vẫn deploy — xem *Mốc so của "chỉ tài liệu"*) |
| push vào `main` mà commit đó **đã** là bản đang chạy | Đủ bộ test, không deploy (không có gì mới). Ép deploy lại: chạy tay trên `main` |
| PR nháp | Bỏ qua (chạy lại khi bấm *Ready for review*) |
| PR thường | unit + build + schema-drift + hygiene (≈ 12 phút) |
| PR thường **có đụng** `server/`, `shared/` (máy chủ import thẳng), `migrations/`, `scripts/`, `package*.json`, `nuxt.config.ts`, `.github/workflows/`, `tests/*integration*`, `tests/fixtures/schema-prev.sql` | thêm 22 job Integration |

**Mốc so của "chỉ tài liệu"** (bước *Docs-only?* của job `changes`): commit **đang chạy trên
production**, không phải `github.event.before`. `before` chỉ là đỉnh cũ của `main`: lượt A đang
deploy, push mã B đang chờ, push chỉ-tài-liệu C tới → GitHub huỷ B (nhóm concurrency chỉ giữ
một lượt chờ), C so B..C = chỉ tài liệu → không deploy, và mã của B không bao giờ lên production
dù CI xanh (cùng chuyện khi B đỏ một cổng chập chờn trước `image`). Mốc được tìm theo thứ tự:

1. **`VPS_SMOKE_URL` có đặt** → `GET <VPS_SMOKE_URL>/api/public/health?t=<run>-plan` (`curl -fsSL
   -m 10 --retry 2`), lấy `version` (12 ký tự SHA nướng vào image) — chỉ nhận đúng 12 ký tự hex,
   tra ra commit bằng `git rev-parse`;
2. **không có / không dùng được** (biến trống, trang không trả lời, `dev`, commit lạ) → `gh api`
   (quyền `actions: read`, chỉ cấp cho job `changes`): trong 30 lượt chạy mới nhất của workflow
   trên `main`, xếp theo lúc bắt đầu chạy (lượt *re-run* tính theo lần chạy lại), lấy `head_sha`
   của lượt đầu tiên có **job** `Deploy to VPS` kết luận `success` — lượt chỉ-tài-liệu cũng
   `success` nhưng job deploy `skipped`, nên xét job chứ không xét lượt;
3. **không ra mốc nào**, mốc không phải tổ tiên của commit đẩy lên, diff hỏng, hoặc diff rỗng mà
   khác commit → **deploy**.

Mốc == commit đẩy lên → không deploy. Mốc (2) có thể "mới" hơn thực tế nếu ai đó lùi phiên bản
bằng tay ngoài CI — đặt `VPS_SMOKE_URL` để mốc (1) là đường thường. Lượt chạy của push vào `main`
chỉ bắt đầu khi lượt trước trong nhóm đã xong hẳn, nên kết quả deploy trước đó đã ngã ngũ lúc
mốc được đọc. `tests/ci-docs-only-skip.test.ts` chạy thật bước này (curl/gh giả).

Muốn ép chạy đủ cho một PR chỉ-giao-diện: Actions → CI → *Run workflow* trên nhánh đó.
Gom commit trước khi push và dùng PR nháp cho việc dở dang cũng tiết kiệm phút.
Kiểm lượng đã dùng: GitHub → Settings → Billing and licensing → Usage.

Package trên GHCR **mặc định là private** (dù repo public hay private) — nên VPS
bắt buộc phải `docker login` (Bước 4–5). Repo public thì Actions không tính phút; nếu
repo chuyển private, mỗi lượt đủ bộ ăn vào hạn mức ở trên.

---

## Cài đặt lần đầu

> Các lệnh dưới đây dùng chỗ thay thế — điền giá trị của bản triển khai vào:
>
> | Chỗ thay thế | Là gì |
> |---|---|
> | `<VPS_HOST>` | IP hoặc domain của VPS |
> | `<VPS_PORT>` | cổng SSH (mặc định `22`) |
> | `<VPS_USER>` | user deploy (`root`, hoặc user đã ở group `docker`) |
> | `<APP_DIR>` | thư mục chứa `docker-compose.yml` trên VPS |
> | `<OWNER>/<REPO>` | đường dẫn repo trên GitHub |
>
> **Cố ý không ghi giá trị thật vào đây.** Repo từng public (và có thể public lại): địa chỉ máy chủ, cổng
> SSH và tên user deploy không phải bí mật, nhưng gom cả bốn thứ vào một trang ai
> cũng đọc được là tự soạn sẵn phiếu thông tin cho người quét cổng. Giá trị thật
> nằm ở GitHub Secrets/Variables và trong `.env` trên máy chủ.

### Bước 1 — Tạo khoá SSH riêng cho CI

Khoá riêng cho việc deploy, **không** dùng lại khoá cá nhân: thu hồi được mà không
ảnh hưởng gì tới việc tự ssh vào máy chủ.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/cdkt_deploy -N '' -C 'github-actions-deploy'
ssh-copy-id -i ~/.ssh/cdkt_deploy.pub -p <VPS_PORT> <VPS_USER>@<VPS_HOST>
```

Ghi lại fingerprint mà `ssh-copy-id` hiện ra — Bước 2 sẽ đối chiếu với nó.

Lấy nội dung khoá riêng để dán vào GitHub:

```bash
cat ~/.ssh/cdkt_deploy       # copy TOÀN BỘ, kể cả dòng BEGIN/END
```

Nếu deploy bằng user thường (không phải `root`), user đó phải ở trong group `docker`:

```bash
sudo usermod -aG docker <user>     # rồi đăng xuất/đăng nhập lại
```

> ⚠️ **Sinh khoá trên máy đích thì phải xoá bản sao sau khi dán vào secret.** Giữ
> khoá riêng nằm trên chính máy nó mở là thêm một bản sao không có lý do tồn tại:
> ```bash
> rm ~/.ssh/cdkt_deploy      # giữ lại cdkt_deploy.pub và authorized_keys
> ```

### Bước 2 — Ghim khoá máy chủ

Đối chiếu fingerprint trước, rồi mới lấy nội dung:

```bash
# Dòng ED25519 phải khớp fingerprint ssh-copy-id đã hiện ở Bước 1
ssh-keyscan -p <VPS_PORT> <VPS_HOST> 2>/dev/null | ssh-keygen -lf -

# Khớp thì lấy nội dung — copy 3 dòng khoá, bỏ các dòng bắt đầu bằng '#'
ssh-keyscan -p <VPS_PORT> <VPS_HOST>
```

> Chỉ chạy `ssh-keyscan` **một lần ở đây**, trên một máy anh tin tưởng, rồi ghim kết
> quả vào secret. Workflow **không** tự keyscan lúc chạy: keyscan là "tin bên nào trả
> lời" ở mọi lần chạy, tức là không chặn được ai xen giữa — mà bên xen giữa đó sẽ
> nhận trọn phiên deploy. Đối chiếu fingerprint là bước duy nhất biến trust-on-first-use
> thành trust-on-verification.

### Bước 3 — Khai secret và variable trên GitHub

`Settings → Secrets and variables → Actions`

**Secrets** (tab *Secrets*):

| Tên | Giá trị |
|---|---|
| `VPS_HOST` | IP hoặc domain của VPS |
| `VPS_USER` | `root`, hoặc user đã thêm vào group `docker` (khuyến nghị — khoá `restrict` trong `authorized_keys`: `production/README.md` § *User deploy không phải root*) |
| `VPS_SSH_KEY` | **toàn bộ nội dung** `~/.ssh/cdkt_deploy` (Bước 1) |
| `VPS_SSH_KNOWN_HOSTS` | 3 dòng `ssh-keyscan` ở Bước 2 |

**Variables** (tab *Variables*):

| Tên | Giá trị | Mặc định nếu bỏ trống |
|---|---|---|
| `VPS_PORT` | cổng SSH | `22` |
| `VPS_APP_DIR` | đường dẫn repo trên VPS, vd `/www/wwwroot/<tên-site>` | *(bắt buộc)* |
| `VPS_SMOKE_URL` | địa chỉ công khai của cổng, vd `https://conduonghuongthien.com.vn` (không `/` cuối cũng được) | bỏ qua bước smoke, job in `::warning::`; job Plan tìm bản đang chạy qua lịch sử lượt chạy thay vì hỏi trang |

> **`VPS_SMOKE_URL`** — sau khi container trên VPS `healthy`, bước *Smoke test through the
> public URL* hỏi `GET <VPS_SMOKE_URL>/api/public/health?t=<run>-<lần>` (`curl -fsSL -m 10`,
> theo cả chuyển hướng; đi qua nginx, CDN, DNS — đúng đường khách đi) tối đa 12 lần, nghỉ
> 10 giây giữa hai lần (không nghỉ sau lần cuối), và chỉ coi là xong khi nhận **200** với
> `version` bằng SHA ngắn vừa deploy. Cửa sổ chờ: ~2 phút khi mỗi lần trang trả lời ngay, tệ
> nhất ~3 phút 50 giây (12 × trần 10 s của curl + 11 × 10 s nghỉ). Hết 12 lần: job **đỏ nhưng
> không tự lùi** (nguyên nhân có thể là CDN/DNS chứ không phải image; lùi một container đang
> khoẻ vì CDN chậm là sai) — làm theo mục Deploy trong *Summary* của lượt chạy và § *Lùi
> phiên bản* bên dưới. Job Plan cũng hỏi chính URL này để biết bản đang chạy (mốc so của
> "chỉ tài liệu", ở trên).
> Endpoint `/api/public/health` (`server/api/public/health.get.ts`): `SELECT 1` qua pool chung,
> trần 2 giây, luôn `Cache-Control: no-store`, 200 `{ ok: true, version }` / 503 `{ ok: false }`.
> Dùng chính URL này cho dịch vụ giám sát uptime.

> `VPS_SSH_KNOWN_HOSTS` không phải bí mật thật (khoá công khai của máy chủ, ai
> `ssh-keyscan` cũng lấy được). Nó nằm ở Secrets chỉ vì Variables không tiện cho
> giá trị nhiều dòng.

> Thiếu bất kỳ mục bắt buộc nào thì job `deploy` **dừng ngay** với thông báo nêu đúng
> tên còn thiếu, chứ không ssh vào rồi hỏng giữa chừng.

### Bước 4 — Tạo token đọc GHCR

`github.com/settings/tokens` → *Generate new token (classic)*

- Note: `cdkt-vps-pull`
- Scopes: **chỉ tick `read:packages`** — không tick gì khác

Token chỉ hiện đúng một lần.

### Bước 5 — Cho VPS đăng nhập GHCR

```bash
# trên VPS, bằng ĐÚNG user đã khai ở VPS_USER
echo '<PASTE_TOKEN>' | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin
```

Thông tin lưu ở `~/.docker/config.json` của **chính user deploy** (`VPS_USER=root`
thì phải login bằng `root`). Kiểm tra:

```bash
docker pull ghcr.io/<OWNER>/<REPO>:latest
```

> Muốn bỏ hẳn bước này thì vào `github.com/users/<owner>/packages` → chọn package
> → *Package settings* → *Change visibility* → **Public**. Image **không chứa bí mật
> nào** (`.env` bị `.dockerignore` loại, `ADMIN_PASSWORD` vào bằng BuildKit secret nên
> không nằm trong `docker history`, mọi secret đọc lúc chạy). Nhưng để private thì
> không mất gì ngoài một lần `docker login`, nên mặc định cứ để private.

### Bước 6 — Cập nhật repo trên VPS

Script deploy **không** `git pull`, nhưng **tự gửi `docker-compose.yml`** của đúng
commit đang triển khai lên `<APP_DIR>` mỗi lượt (trước đây VPS dùng bản compose nằm
sẵn từ lần `git pull` cuối — bước dễ bỏ sót nhất, và một biến mới thêm vào compose
không bao giờ tới được container). Lượt deploy:

1. nhận tệp vào `<APP_DIR>/.docker-compose.incoming.yml` (và `scripts/backup-db.sh` của
   commit vào `<APP_DIR>/.deploy-incoming/backup-db.sh`), kiểm **SHA-256** cả hai — tệp
   cụt do SSH đứt thì dừng trước cả `docker pull`;
2. `docker pull` image;
2b. **dump CSDL** bằng chính `backup-db.sh` vừa nhận (`--prefix cdkt-predeploy`, cùng
   phép kiểm gzip / dòng `-- Dump completed` ở đầu một trong 5 dòng cuối (đúng luật
   `restore-db.sh` nhận — hai script mang cùng một khối, test so) / ≥ 20 bảng như cron đêm) vào
   `<APP_DIR>/.deploy-db-backups/cdkt-predeploy-<db>-<thời-điểm UTC>-<pid>.sql.gz`, giữ
   **5 bản** mới nhất. Dump hỏng (đĩa đầy, mysql không chạy) → **dừng**, chưa compose,
   `.env` hay container nào bị đụng. Thư mục nằm cạnh `.deploy-compose-backups/` chứ
   không trong `./backups`: `./backups` là bind mount mà container giao cho user `node`
   (uid 1000) mỗi lần khởi động, user deploy chưa chắc ghi được. Bản dump không gửi ping
   giám sát (`HEALTHCHECK_PING_URL` chỉ dành cho cron đêm). Dump là toàn bộ CSDL production:
   tệp quyền **600**, thư mục `.deploy-db-backups/` **700** (đặt lại cả khi đã có sẵn với
   quyền rộng hơn); tệp viết dưới tên `….sql.gz.partial`, chỉ đổi sang `.sql.gz` sau khi
   kiểm xong — nên **không bao giờ** có một `.sql.gz` cụt mang tên thật, dù lượt dump dừng
   kiểu gì. Lượt nhận HUP/INT/TERM (Ctrl-C, `kill`) xoá luôn phần dở dang. Job bị huỷ hay
   SSH đứt thì khác: phiên `ssh` của CI không có PTY, phía VPS không nhận tín hiệu treo máy
   nào — script chạy tiếp, hoặc chết vì SIGPIPE ở lần ghi log kế tiếp và để lại
   `….sql.gz.partial`; lượt dump sau cùng họ xoá nó khi đã quá 1 ngày. Phiên SSH của job có keep-alive
   (`ServerAliveInterval=30`, `ServerAliveCountMax=10`) để một bản dump lâu không bị NAT/tường
   lửa cắt vì "rảnh";
3. sao lưu `docker-compose.yml` cũ vào `<APP_DIR>/.deploy-compose-backups/`
   (giữ 10 bản gần nhất; compose không đổi thì không sao lưu, không ghi gì);
4. đặt bản mới, chạy `docker compose config -q` **trên chính VPS** (gồm cả
   `docker-compose.override.yml` nếu có, và bắt được biến bắt buộc mới mà `.env`
   chưa có) — sai thì trả bản cũ về và dừng, **chưa container nào, chưa dòng `.env`
   nào bị đụng**;
4b. **log của app** (wave2 D-LOG): compose cho app ghi vào journald (`tag: cdkt-app`).
   `ensure_log_driver "$IMAGE"` kiểm máy chủ dùng được systemd-journald: socket
   `/run/systemd/journal/socket`, `journalctl`, daemon có driver `journald`
   (`timeout 20 docker info … .Plugins.Log`) và một container thử `timeout 60 docker run
   --rm --pull=never --network none --log-driver journald --entrypoint true <image vừa kéo>`. Không có → ghi
   `<APP_DIR>/docker-compose.override.yml` mang dấu `# cdkt-log-fallback` (app dùng
   `json-file` 3 × 10 MB) và in `::warning::`; có journald mà tệp có dấu còn → gỡ nó.
   Override **không** mang dấu (của người vận hành) không bao giờ bị sửa; khi đó
   `docker compose config` cho biết driver hiệu lực của app — vẫn là journald thì
   `::error::`, trả compose cũ về và dừng (chưa `.env`, chưa container). Chạy sau bước 4
   để driver hiệu lực tính trên compose của commit này. Cùng ba hàm, giống từng chữ, ở
   `production/manage.sh` Deploy/Update;
5. khởi động lại **chỉ app**: `up -d --no-recreate mysql` (bật mysql nếu đang dừng,
   không bao giờ tạo lại) rồi `up -d --no-deps app`. Thay đổi ở service `mysql` không
   được CI tự áp — người vận hành chạy `docker compose up -d` trong giờ thấp điểm.

Vẫn cần clone repo một lần (thư mục chứa `.env`, `./backups`, `production/`):

```bash
cd <APP_DIR>
git pull origin main
grep -n 'CDKT_IMAGE' docker-compose.yml     # phải thấy: image: ${CDKT_IMAGE:-cdkt/app:local}
```

> ⚠️ **`docker-compose.yml` trên VPS do CI quản lý.** Sau lượt deploy đầu, `git status`
> trên VPS thấy tệp này "đã sửa", và `git pull` (kể cả trong `./manage.sh` → Update)
> **từ chối** mỗi khi lượt kéo đó cũng đổi compose. Tệp CI đặt luôn là bản đã commit
> trên `main`, nên an toàn để bỏ: `git checkout -- docker-compose.yml && git pull origin main`.
> Script deploy in nhắc dòng này mỗi khi tệp khác bản trong `HEAD`.
>
> **Mã ứng dụng và `docker-compose.yml` đi theo CI; phần còn lại của repo trên VPS
> (`production/`, `docker/`, `scripts/`) vẫn đi bằng `git pull`.**

### Bước 7 — Bổ sung `.env` trên VPS

Tên docker network lấy theo **tên thư mục** chứa `docker-compose.yml`, nên phải tự dò
chứ không đoán:

```bash
cd <APP_DIR>
docker network ls | grep default
docker network inspect <tên-vừa-thấy> --format '{{(index .IPAM.Config 0).Gateway}}'
```

Rồi thêm vào cuối `.env`:

```env
# CI ghi đè dòng này mỗi lần deploy; giá trị ban đầu chỉ để lần đầu chạy được.
CDKT_IMAGE=ghcr.io/<OWNER>/<REPO>:latest

# BẮT BUỘC khi có nginx/aaPanel đứng trước. Docker gateway IP thay đổi theo
# network name, nên dùng CIDR 172.16.0.0/12 cover toàn dải Docker private
# thay vì IP cố định — đặt sai là lỗi IM LẶNG (xem below).
TRUSTED_PROXY_IPS=172.16.0.0/12
```

⚠️ **CI không bao giờ ghi đè các dòng khác trong `.env`.** Script deploy chỉ thay
đúng dòng `CDKT_IMAGE=`, ghi qua tệp tạm rồi `mv` nguyên tử và giữ nguyên chủ sở hữu
lẫn quyền. `JWT_SECRET`, mật khẩu CSDL và các bí mật khác **ở lại trên VPS** — GitHub
không biết chúng, và đúng ra là phải vậy: xoay `JWT_SECRET` sẽ vô hiệu hoá **toàn bộ
secret TOTP đã lưu** (xem runbook trong `CLAUDE.md`), nên nó không được phép là thứ
một pipeline tự sinh ra.

`TRUSTED_PROXY_IPS` sai là một lỗi **im lặng**: giới hạn tần suất theo IP gộp lại
thành một bucket chung cho cả internet, và `activity_logs` ghi IP của proxy thay vì
của khách. Không có gì báo lỗi cả — nên phải dò đúng, đừng chép giá trị mẫu.

### Bước 8 — Reverse proxy trên aaPanel

Làm bước này **trước** khi deploy, vì app bind vào `127.0.0.1`:

`Website → <domain> → Reverse Proxy → Add`
- Target URL: `http://127.0.0.1:54432` (khớp `PORT` trong `.env` — kiểm bằng `grep '^PORT=' .env`)
- **Tắt cache** (`Cache` = off) — cache một trang admin đã đăng nhập là phát nó cho người kế tiếp
- Bật SSL: `Website → SSL → Let's Encrypt`

Trong phần *Config* của site, đảm bảo có (aaPanel mặc định đã có):

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
client_max_body_size 20M;

# ── Tải video lên theo phần (Media Portal) ────────────────────────────────
# 12g chứ không 10g: phần tải lên là multipart, nên thân request lớn hơn dữ
# liệu thật. Để đúng bằng trần ứng dụng (`MEDIA_UPLOAD_MAX_SIZE`) thì nginx
# từ chối bằng 413 đúng những phần mà ứng dụng sẵn sàng nhận — và nó từ chối
# trước khi ứng dụng thấy request, nên không có log nào phía cổng giải thích.
location /api/admin/media-portal/ {
    proxy_pass http://127.0.0.1:54432;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    client_max_body_size 12g;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}

# ── Luồng SSE của chat trực tiếp ──────────────────────────────────────────
# `X-Accel-Buffering: no` đã do tầng ứng dụng đặt, nên ở đây chỉ cần phần của
# nginx: đệm và cache. Đệm là thứ giết SSE — nginx gom bytes lại, nên một tin
# nhắn chat nằm trong bộ đệm proxy tới khi đầy hoặc tới khi stream đóng; khách
# gõ xong mà người kia không thấy gì. `proxy_cache off` cùng lý do: một luồng
# phục vụ lại từ cache là cuộc trò chuyện của người khác.
# `proxy_read_timeout 86400s` vì một phiên chat đang mở là một request chưa
# kết thúc — ngắt nó theo lịch là đóng cuộc trò chuyện mà không ai bấm gì.
location /api/public/livestream/chat/stream {
    proxy_pass http://127.0.0.1:54432;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}

# ── Luồng SSE của chatbot AI ──────────────────────────────────────────────
# Provider AI có lúc mất 40–200 giây cho một câu trả lời (suy nghĩ rồi mới có chữ
# đầu tiên). Suốt lúc đó server gửi một dòng `: ping` mỗi 15 giây để giữ kết nối;
# nhưng nginx vẫn phải cho phép kết nối sống lâu và KHÔNG đệm: với
# `proxy_read_timeout` mặc định (60s) một câu chậm bị cắt giữa chừng, và có đệm thì
# chữ nhảy thành khối thay vì hiện dần. `proxy_cache off` vì một luồng phục vụ lại từ
# cache là câu trả lời của người khác.
location /api/public/chatbot {
    proxy_pass http://127.0.0.1:54432;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

Ba khối `location` trên phải nằm trong **cùng** khối `server { }` với các dòng
`proxy_set_header` ở trên — dán rời ra ngoài thì nginx báo lỗi cú pháp, hoặc tệ
hơn là nhận mà không có hiệu lực. Nhớ đổi `54432` cho khớp `PORT` trong `.env`.

Kiểm tra khối chatbot đã có hiệu lực (phải thấy `: ping` xen kẽ mỗi 15 giây trong lúc
chờ, thay vì im lặng rồi bị ngắt ở ~60 giây):

```bash
curl -N -s -X POST https://<domain>/api/public/chatbot \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"có hỗ trợ vay vốn không?"}]}' | head -20
```

Thiếu `X-Forwarded-For` thì mọi khách trông như cùng một địa chỉ, và giới hạn tần
suất theo IP gộp thành một bucket chung cho cả internet.

**IP thật sau Cloudflare — BẮT BUỘC khi tên miền đi qua Cloudflare (proxy cam).**
Với Cloudflare đứng trước nginx, `$remote_addr` của nginx là IP **edge của
Cloudflare**, và `$proxy_add_x_forwarded_for` đặt chính IP đó ở cuối
`X-Forwarded-For`. App (`server/utils/client-ip.ts`) đọc header phải→trái và dừng ở
hop đầu tiên không nằm trong `TRUSTED_PROXY_IPS` (`172.16.0.0/12` chỉ phủ dải
docker) — tức là dừng ở IP edge. Hệ quả **im lặng**: mọi khách sau cùng một edge
dùng chung bucket giới hạn tần suất (đăng nhập, form, chat) và chung trần lượt xem
bài **60 lượt / 10 phút** (`view.post.ts`) — lượt xem thật bị đếm thiếu; nhật ký ghi
IP edge thay vì IP khách. Sửa ở **nginx** (không đổi `client-ip.ts`), mô-đun
`ngx_http_realip_module` (aaPanel có sẵn):

```bash
# Sinh danh sách dải IP Cloudflare từ nguồn chính thức (chạy lại khi Cloudflare đổi dải).
# Ghi ra tệp tạm, kiểm rồi mới thay: một lần curl hỏng giữa chừng không được để lại
# tệp rỗng/cụt (nginx sẽ lặng lẽ thôi tin Cloudflare, hoặc tin nhầm dải).
set -euo pipefail
out=/www/server/nginx/conf/cloudflare-realip.conf
tmp="$(mktemp)"
{ curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; } \
  | sed '/^\s*$/d; s/.*/set_real_ip_from &;/' > "$tmp"
total=$(grep -c '^set_real_ip_from ' "$tmp" || true)
malformed=$(grep -cvE '^set_real_ip_from [0-9A-Fa-f:.]+/[0-9]{1,3};$' "$tmp" || true)
if [ "$total" -lt 10 ] || [ "$malformed" -ne 0 ]; then
  echo "Danh sách Cloudflare rỗng/không hợp lệ ($total dòng, $malformed dòng lạ) — giữ tệp cũ" >&2
  rm -f "$tmp"; exit 1
fi
install -m 644 "$tmp" "$out" && rm -f "$tmp"
nginx -t && nginx -s reload
```

```nginx
# Trong khối server { } của site (trước các proxy_set_header):
include /www/server/nginx/conf/cloudflare-realip.conf;
real_ip_header CF-Connecting-IP;
```

Chỉ kết nối đến **từ dải Cloudflare** mới được thay `$remote_addr` bằng
`CF-Connecting-IP`; ai gọi thẳng vào IP gốc vẫn mang địa chỉ thật của họ, nên không
giả được header. Sau đó `X-Real-IP $remote_addr` và `$proxy_add_x_forwarded_for` tự
mang IP khách. `nginx -t && nginx -s reload`.

**Không nên** "sửa" bằng cách thêm dải Cloudflare vào `TRUSTED_PROXY_IPS`: `client-ip.ts`
từ chối CIDR IPv6 (Cloudflare có 7 dải IPv6), nên khách IPv6 vẫn ra IP edge; và
nginx vẫn ghi IP edge vào access log, `X-Real-IP` vẫn sai — chỉ app được vá một nửa.
Khôi phục IP ở nginx sửa tất cả cùng lúc.

Kiểm tra (làm trước khi merge thay đổi có trần lượt xem, và sau mỗi lần đổi proxy):
1. Lấy IP của chính mình: `curl -s https://<domain>/cdn-cgi/trace | grep '^ip='`.
2. Đăng xuất admin rồi xem dòng mới nhất:
   `SELECT created_at, JSON_UNQUOTE(JSON_EXTRACT(meta,'$.ip')) AS ip FROM activity_logs WHERE action='logout' ORDER BY id DESC LIMIT 5;`
   — phải là IP ở bước 1, **không** phải một địa chỉ trong dải Cloudflare
   (`104.16.0.0/13`, `172.64.0.0/13`, `162.158.0.0/15`, `2606:4700::/32`… — đối chiếu
   https://www.cloudflare.com/ips/).
3. Log app: `docker logs cdkt_app 2>&1 | grep article_view.ip_ceiling_hit` — một vài
   dòng là bình thường (một nguồn xem > 60 bài / 10 phút); dòng lặp lại với `bucket`
   là IP Cloudflare nghĩa là real-IP chưa đúng.

**Host và `X-Forwarded-Host` — liên kết trong email.** Email thông báo chứa liên kết
tuyệt đối dựng từ host của request (để cổng chạy được nhiều tên miền). Hai header đó
do client gửi, nên phải chặn ở cả hai tầng:

1. **nginx**: `proxy_set_header X-Forwarded-Host $host;` có ở khối chính **và** ở mỗi
   `location` có `proxy_set_header` riêng (như ba khối trên) — một `location` khai
   `proxy_set_header` là bỏ toàn bộ danh sách của khối `server`, và header client gửi
   kèm sẽ lọt thẳng vào app. Thêm một site mặc định từ chối mọi tên miền lạ, để request
   mang `Host` tuỳ ý không bao giờ tới được app (`/www/server/panel/vhost/nginx/0.default.conf`
   trên aaPanel, hoặc khối `server` riêng):

   ```nginx
   server {
       listen 80 default_server;
       listen 443 ssl default_server;
       server_name _;
       ssl_reject_handshake on;   # nginx ≥ 1.19.4 — không cần chứng chỉ giả
       return 444;
   }
   ```

   Mỗi cặp địa chỉ:cổng chỉ được **một** `default_server` — `0.default.conf` của aaPanel
   có thể đã khai sẵn; sửa khối đó thay vì thêm khối thứ hai. Luôn chạy `nginx -t` trước
   khi reload.

2. **app**: đặt `PUBLIC_HOST_ALLOWLIST` trong `.env` — mọi tên miền thật của cổng, phẩy
   ngăn cách (`conduonghuongthien.com.vn,www.conduonghuongthien.com.vn`). Host không có
   trong danh sách (và khác host của `PUBLIC_BASE_URL`) thì liên kết email dùng
   `PUBLIC_BASE_URL`. Bỏ trống cả hai thì app giữ hành vi cũ và ghi một dòng
   `security.link_host_unchecked` vào log. Redirect URI của Google vẫn suy từ request —
   Google tự so với danh sách URI đã đăng ký, host giả chỉ nhận `redirect_uri_mismatch`.

### Bước 9 — Chạy thử

Merge một commit vào `main`, hoặc bấm *Actions → CI → Run workflow*. Theo dõi hai job
`Build and push image` và `Deploy to VPS`. Xong thì phần *Summary* của lần chạy ghi
rõ image đã triển khai và câu lệnh lùi phiên bản.

Kiểm tra trên VPS:

```bash
docker inspect --format '{{.State.Health.Status}}' cdkt_app
grep '^CDKT_IMAGE=' <APP_DIR>/.env
```

Phải thấy `healthy` và `CDKT_IMAGE=ghcr.io/...:sha-<commit>` (tag SHA, không phải
`latest`).

---

## Checklist trước lần deploy đầu tiên

| # | Việc | Kiểm bằng |
|---|---|---|
| 1 | 4 secret đã khai | `Settings → Secrets` thấy đủ `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_KNOWN_HOSTS` |
| 2 | Variable đã khai | `Settings → Variables` thấy `VPS_PORT`, `VPS_APP_DIR`, `VPS_SMOKE_URL` (cái cuối tuỳ chọn — thiếu thì bước smoke chỉ cảnh báo) |
| 3 | Khoá riêng đã xoá khỏi VPS | `ls ~/.ssh/` không còn `cdkt_deploy` |
| 4 | VPS đăng nhập được GHCR | `docker pull ghcr.io/<OWNER>/<REPO>:latest` |
| 5 | Repo đã clone trên VPS (compose thì CI tự gửi mỗi lượt) | `ls <APP_DIR>/docker-compose.yml <APP_DIR>/.env` |
| 6 | `.env` có `CDKT_IMAGE` và `TRUSTED_PROXY_IPS` | `grep -E '^(CDKT_IMAGE\|TRUSTED_PROXY_IPS)=' .env` |
| 7 | Reverse proxy đã trỏ đúng cổng, cache tắt | Mở domain bằng HTTPS thấy trang chạy |

---

## Vận hành

### Deploy hàng ngày

Merge vào `main`. Không cần làm gì trên VPS.

Job `image` và `deploy` **chỉ chạy trên `main`** — push lên nhánh phụ hay mở pull
request chỉ chạy bốn cổng kiểm tra. Đây là chủ đích: deploy một pull request là đẩy
mã của một fork lên máy chủ.

### Làm mới fixture lược đồ của bản trước (sau mỗi bản phát hành)

Suite `tests/schema-upgrade-integration.test.ts` (job *Integration · schema-upgrade*) làm ba việc:
- nạp `tests/fixtures/schema-prev.sql`, tức lược đồ mà `initDb()` của **bản đang chạy trên production** dựng ra;
- chèn hàng đại diện vào mọi bảng mà một bước migration lúc khởi động đụng tới, và mọi bảng mà `seed.ts` ghi. Ở mỗi bảng seed ghi, có hàng mang khoá default: mọi cột seed ghi đều mang giá trị khác default (như thể cán bộ đã sửa), nên seed ghi đè dữ liệu cán bộ là thấy ngay;
- khởi động mã mới hai lần (`init.ts` → `seed.ts`).

Lượt 1 chỉ được đổi dữ liệu qua các chuyển đổi một lần đã khai báo trong suite, mỗi chuyển đổi kèm lý do. Lượt 2 không được đổi gì. Fixture phải là lược đồ của bản **đang chạy**, nên làm mới nó **sau khi** một bản lên production. Làm mới sớm hơn thì fixture đã chứa sẵn các cột mới, và suite không còn kiểm đường nâng cấp của chúng nữa. Repo không có tag phát hành, nên mốc là commit đang chạy.

```bash
# 1. Commit đang chạy: trường `version` (12 hex) của health
curl -fsS https://<domain>/api/public/health
# 2. Chụp lược đồ của commit đó vào một CSDL tạm (script tự tạo rồi xoá CSDL
#    `cdkt_snapshot_*` và thư mục tạm; cần quyền CREATE/DROP DATABASE). MySQL dev
#    docker: cổng 33069. Không in mật khẩu ra lịch sử shell.
SNAPSHOT_DB_PORT=33069 SNAPSHOT_DB_PASSWORD="$MYSQL_ROOT_PASSWORD" \
  node --experimental-strip-types --import ./scripts/ts-resolver.mjs \
  scripts/snapshot-schema.ts --ref <version>
# 3. Kiểm và commit cùng PR kế tiếp
git diff --stat tests/fixtures/schema-prev.sql
SCHEMA_UPGRADE_INTEGRATION=1 SCHEMA_UPGRADE_PORT=33069 SCHEMA_UPGRADE_PASSWORD="$MYSQL_ROOT_PASSWORD" \
  node --experimental-strip-types --experimental-test-module-mocks --import ./scripts/ts-resolver.mjs \
  --test tests/schema-upgrade-integration.test.ts
```

- **Script.** Nó chạy `server/db/init.ts` **của commit đó**: dùng `git archive`, mượn `node_modules` của checkout hiện tại qua symlink, và không đụng cây làm việc. Rồi nó ghi `SHOW CREATE TABLE` của từng bảng (cùng nội dung `mysqldump --no-data` in ra). Bảng xếp theo tên, không có bộ đếm `AUTO_INCREMENT`, không ngày giờ, không `DROP`. Chạy hai lần cho ra cùng từng byte. Header ghi ref, SHA đầy đủ và phiên bản MySQL.
- **Commit chung với gì.** Một PR **chỉ** làm mới fixture vẫn chạy job Integration (đường dẫn này có trong bộ lọc của job `changes`). Nếu bản mới vừa thêm chuyển đổi một lần, suite sẽ không còn thấy nó chạy (cột đã có sẵn trong fixture). Khi đó khai báo của nó hiện ở dòng chẩn đoán *declared but not reachable from this fixture*. Giữ khai báo nếu mã còn đó; xoá khai báo khi mã đã xoá (test *every declared conversion still names code that exists* sẽ đỏ).
- **Khi suite đỏ.** Thông báo có dạng `bảng.cột [khoá]: cũ → mới`. Một bước khởi động đang ghi đè dữ liệu. Sửa bước đó cho có điều kiện (theo trạng thái lược đồ, `WHERE cột IS NULL`…). Chỉ khi việc ghi là chuyển đổi một lần có chủ đích thì mới thêm vào `DECLARED_CONVERSIONS`, kèm mã nguồn (neo theo nội dung) và lý do.
- **Ghi vào chính cột vừa thêm, hoặc chỉ chạy khi có dữ liệu đầu vào.** Lượt so chỉ so các cột có ở cả hai ảnh chụp, nên giá trị một bước ghi vào cột nó vừa thêm (2A `reader_accounts.display_name_reserved`, 2C `articles.view_total*`) không hiện thành thay đổi. Khi đó: khai báo riêng cho bước đó (đặt trước `additive.add-column` để cột thêm vào được tính cho đúng nó) và khẳng định kết quả ngay sau lượt 1; lượt 2 vẫn chứng minh bước đó không ghi lại. Bước chỉ **đọc** một bảng không bước nào ghi (lượt đối soát tổng lượt xem đọc `article_view_daily`) thì thêm bảng đó vào `BOOT_READ_TABLES` của suite, nếu không thì nhánh ghi không bao giờ chạy trên dữ liệu đại diện.

### Lùi phiên bản

> ⚠️ **Lùi tay chỉ tạm thời — lượt merge kế tiếp vào `main` sẽ deploy lại HEAD.** Khi đã đặt
> `VPS_SMOKE_URL`, job Plan so với bản **đang chạy** (bản vừa lùi về), nên `HEAD` của `main`
> — gồm cả commit hỏng — khác bản đó ở tệp mã: merge kế tiếp, **kể cả merge chỉ sửa tài
> liệu**, build và deploy lại `HEAD` đè lên bản đã lùi. Trước lượt merge kế tiếp phải
> **revert commit hỏng trên `main`** (hoặc merge bản sửa). Chưa đặt `VPS_SMOKE_URL` thì mốc là
> lượt deploy CI thành công gần nhất — có thể chính là commit hỏng — nên một merge chỉ-tài-liệu
> có thể không deploy, nhưng merge có mã thì vẫn deploy `HEAD`: cũng phải revert trước.

Mỗi lần deploy đẩy một tag `sha-<commit>`. Lùi được về image còn trên VPS (6 bản: đang chạy
+ 5 bản `sha-*` mới nhất trước đó) hoặc còn trên GHCR (20 version mới nhất — xem *Giữ image*
bên dưới):

```bash
cd <APP_DIR>
# Nếu lượt deploy đó cũng đổi compose: trả compose cũ về (bản trước lượt đó, theo giờ UTC trong tên)
ls .deploy-compose-backups/
cp -p .deploy-compose-backups/docker-compose.<thời-điểm>.yml docker-compose.yml
docker compose config -q
sed -i 's|^CDKT_IMAGE=.*|CDKT_IMAGE=ghcr.io/<OWNER>/<REPO>:sha-<commit-cũ>|' .env
docker compose up -d --no-deps app
docker inspect --format '{{.State.Health.Status}}' cdkt_app
```

Lấy danh sách image còn trên máy: `docker images ghcr.io/<OWNER>/<REPO>`.

**Dữ liệu** cũng lùi được: image mới chạy migration hỏng thì khôi phục bản dump lấy
**ngay trước** lượt đó — bản `cdkt-predeploy-*` mới nhất có giờ (UTC, trong tên) trước
giờ lượt deploy hỏng — đúng cặp với image cũ:

```bash
ls -t <APP_DIR>/.deploy-db-backups/
# dừng app, rồi khôi phục (script tự dump bản hiện có trước khi ghi đè) — DEPLOY.md § Khôi phục thật
docker compose stop app
./scripts/restore-db.sh .deploy-db-backups/cdkt-predeploy-<db>-<thời-điểm>-<pid>.sql.gz <db> --replace
```

### Giữ image (VPS và GHCR)

- **VPS** — sau mỗi lượt deploy khoẻ (và mỗi lượt `./manage.sh` → Update khoẻ),
  `prune_app_images` giữ image **đang chạy + 5 bản `sha-*` mới nhất khác** của repo image
  app (xếp theo thời điểm tạo), gỡ phần còn lại **theo thẻ** bằng `docker image rm` (không
  `-f`: image còn container dùng thì để lại), rồi `docker image prune -f` cho layer lơ
  lửng. Thẻ lùi `cdkt-rollback/app:*` của `manage.sh` không bao giờ bị xét. Đĩa chứa
  dữ liệu Docker dùng **> 80 %** thì job in `::warning::`. (Trước đây script chỉ chạy
  `docker image prune -f --filter until=168h` — lệnh đó **không bao giờ** gỡ image còn
  thẻ, nên mọi image `sha-*` nằm lại mãi.)
- **GHCR** — `.github/workflows/ghcr-retention.yml` chạy hằng tuần (thứ Hai 03:17 UTC) và
  khi bấm tay: `actions/delete-package-versions` (ghim SHA commit) giữ **20 version mới
  nhất** của package image. Tên package = phần sau `<owner>/` của `github.repository`, viết
  thường — đúng đường dẫn job `image` đẩy lên (không dùng `github.event.repository.name`:
  payload của lượt `schedule` không có trường đó, lượt hằng tuần sẽ đọc ra tên rỗng). Job `image` build với `provenance: false` nên một lượt push là
  **một** version, vì vậy 20 version = 20 image `sha-*` (`latest` luôn nằm trên bản mới
  nhất). Action so `ignore-versions` theo digest chứ không theo thẻ, nên không lọc theo
  thẻ được — giữ đúng "một push = một version" là điều kiện để con số 20 đúng. Image đẩy
  trước khi tắt provenance nhiều khả năng có manifest con không thẻ (mặc định của buildx —
  **chưa kiểm** trên package; trang package hiện các version không thẻ `unknown/unknown` nếu
  đúng vậy); khi đó, trong vài tuần chuyển tiếp, image cũ nhất còn giữ có thể mất manifest
  con (không kéo lại được) — VPS không cần nó.
  **Một lần trên GitHub:** package → *Package settings* → *Manage Actions access* → repo
  này quyền **Admin**, nếu không bước xoá báo lỗi quyền (không xoá gì).

### Lùi phiên bản tự động

Container mới không `healthy` trong 300 giây — hoặc chính lệnh `docker compose up`
hỏng, hoặc container **khởi động lại quá 2 lần** trong lúc chờ (crash loop: thiếu biến,
migration hỏng… — `wait_healthy` dừng chờ ngay, in 60 dòng log cuối, thay vì đợi hết 300
giây) — thì script trả `docker-compose.yml` về bản trước lượt này, trỏ `.env` về image
cũ và khởi động lại: image cũ chạy trên compose cũ, đúng cặp đã từng khoẻ. Job vẫn
**thất bại** (exit 1) kể cả khi lùi thành công — commit đó không lên được thì không
được báo là đã lên. Số lần khởi động lại tính từ lúc bắt đầu chờ (compose không tạo lại
một container không đổi gì, nên con số tuyệt đối có thể đã cao từ trước).

**Image cũ chạy trên lược đồ mới.** Lượt lùi xảy ra **sau** khi container mới đã chạy
`init.ts` (di trú bổ sung) — CSDL không lùi theo image. Vì vậy mỗi thay đổi lược đồ phải
để image cũ chạy được trên nó: chỉ thêm cột có mặc định, không đổi nghĩa cột cũ, **không
cột sinh** (image cũ — và bản sao lưu trong app của nó — `SELECT *` rồi `INSERT` mọi cột;
MySQL từ chối mọi giá trị cho cột sinh, lỗi 3105, nên bản sao lưu đó không khôi phục được),
và dữ liệu dẫn xuất phải tự sửa ở lần khởi động sau. Ví dụ đợt 2C: tổng lượt xem trên
`articles` là ba cột thường; image cũ đếm lượt xem không cộng tổng, và lần khởi động kế tiếp
của image mới đối soát (`reconcileArticleViewTotals`, chỉ ghi bài lệch, CSDL khớp thì không
ghi gì) — lùi rồi tiến lại không để lại tổng sai (`tests/view-boost-integration.test.ts`,
`tests/backup-dump-integration.test.ts` dựng đúng bản dump kiểu image cũ).

**Ngoại lệ đã biết — bí mật đã mã hoá (đợt 2A, CHANGELOG § 33).** Lần khởi động đầu của image
từ đợt 2A trở đi mã hoá `smtp_pass`, `r2_secret_key` và `backup_drive_service_account` trong
`settings` (envelope, khoá `CHATBOT_ENCRYPTION_SECRET`). Đây là lượt ghi khởi động duy nhất của
đợt 2 mà image cũ **không** chạy được trên nó: image trước 2A đọc nguyên văn, nên nếu lượt deploy
đầu tiên chứa 2A bị lùi tự động thì gửi email (thông báo, mã OTP qua email), tải ảnh lên R2 và
sao lưu Drive ngừng chạy — job chỉ báo "đã lùi về … khoẻ trở lại". Cách xử lý: nhập lại mật khẩu
SMTP, Secret Key R2 (ảnh) và khoá service account Drive ở trang cài đặt của image đang chạy (code
cũ lưu lại nguyên văn), hoặc sửa lỗi rồi deploy lại bản mới (bản mới đọc được cả hai dạng). Không
đảo lượt mã hoá — xem `production/README.md` § *Bảo mật đợt 2 — 2A*.

### Dừng container êm (`stop_grace_period: 45s`)

`docker stop` gửi SIGTERM rồi chờ; mặc định của Docker là 10 giây, trong khi Nitro cần tới
30 giây (`NITRO_SHUTDOWN_TIMEOUT`) để trả xong request dở và chạy hook `close` (dừng
scheduler sao lưu, worker…). Service app trong compose đặt `stop_grace_period: 45s`.
`CMD` của image kết thúc bằng `exec node …` nên Node là PID 1 và nhận thẳng SIGTERM.

### Dependabot

`.github/dependabot.yml` mở PR cập nhật **hằng tuần** cho `npm`, GitHub Actions và base
image của `Dockerfile`; minor + patch **gộp** thành một PR mỗi hệ sinh thái, tối đa 5 PR mở
mỗi loại; major của `node` (base image) bị bỏ qua — nâng Node là quyết định có kế hoạch.
**Mỗi merge vào `main` là một lượt deploy production**, nên gom các PR Dependabot của tuần
và merge **một lượt** (hoặc gộp vào một nhánh rồi merge một PR), đừng merge lẻ từng cái.
PR Dependabot chạy CI như mọi PR (không secret, không deploy).

### Xoay khoá SSH

```bash
# máy anh
ssh-keygen -t ed25519 -f ~/.ssh/cdkt_deploy_new -N '' -C 'github-actions-deploy'
ssh-copy-id -i ~/.ssh/cdkt_deploy_new.pub -p <VPS_PORT> <VPS_USER>@<VPS_HOST>
# cập nhật secret VPS_SSH_KEY, chạy thử một lần deploy, rồi mới gỡ khoá cũ khỏi
# ~/.ssh/authorized_keys trên VPS
```

Gỡ khoá cũ **sau** khi đã có một lần deploy xanh bằng khoá mới — không phải trước.

### Múi giờ của container

Container app chạy `TZ=Asia/Ho_Chi_Minh` (image + chữ cố định trong compose), mysql giữ
UTC. Lượt deploy đầu tiên mang dòng này dời các lượt "03:00" (analytics, retention)
từ 10:00 sáng giờ VN về đúng 03:00 giờ VN, và ranh giới tháng của hạn mức AI lùi 7
giờ — một lần, không cần thao tác. Chi tiết: mục *Múi giờ* trong [DEPLOY.md](./DEPLOY.md).
`manage.sh` không cần đổi gì: TZ là chữ cố định trong compose, không đọc từ `.env`.

---

## Việc chủ repo phải tự làm (không làm được bằng code)

Kiểm ngày 2026-10-13 bằng `gh api` (chỉ đọc): `main` **chưa được bảo vệ**
(`branches/main/protection` → 404, không có ruleset nào), và có một GitHub
Environment lạc tên `VPS_HOST`. Vì merge vào `main` là lên production ngay, ba việc
dưới đây là lớp chặn cuối cùng mà workflow không tự đặt được:

| # | Việc | Ở đâu |
|---|---|---|
| 1 | **Bảo vệ nhánh `main`**: bắt buộc qua pull request, cấm push thẳng (kể cả admin — bỏ chọn *Allow bypass*), và **required status checks** — **đọc mục *Chọn required checks* ngay dưới bảng trước khi bật**: đặt thẳng năm tên job (`Plan`, `Unit and typecheck`, `Schema drift`, `Production build`, `Secrets and defaults`) với `ci.yml` hiện tại sẽ **khoá cứng mọi PR chỉ sửa tài liệu**. | `Settings → Branches → Add branch ruleset` (hoặc *Branch protection rules*) |
| 2 | *(Tuỳ chọn — **đã chốt: không làm**, xem *Quyết định D2* bên dưới)* **Cổng duyệt tay trước deploy**: tạo Environment `production` với *Required reviewers*, rồi thêm `environment: production` vào job `deploy` (secret cấp repo vẫn dùng được trong job có environment). Workflow **cố ý chưa** có khoá này: đó là quyết định đổi quy trình (mỗi lần merge phải có người bấm duyệt, lượt chờ duyệt giữ chỗ trong nhóm `deploy-production`), không phải một sửa lỗi. | `Settings → Environments → New environment` |
| 3 | **Xoá Environment lạc tên `VPS_HOST`** — đó là tên một *secret*, bị tạo nhầm thành Environment. Ngày kiểm, nó **không chứa secret hay variable nào** và không job nào khai `environment:`; bốn secret `VPS_*` thật nằm ở cấp repo. Kiểm lại trước khi xoá: `gh api repos/<OWNER>/<REPO>/environments/VPS_HOST/secrets`. | `Settings → Environments → VPS_HOST → Delete` |

### Chọn required checks (việc #1) — vì sao không đặt thẳng năm tên job

Hai luật của GitHub quyết định chuyện này:

- **Workflow không chạy thì check bắt buộc không bao giờ có kết quả.** `on.pull_request`
  trong `ci.yml` có `paths-ignore: ['**.md', 'docs/**', 'openspec/**']`: PR chỉ sửa tài
  liệu **không khởi động** workflow, nên `Plan`, `Unit and typecheck`… nằm ở *Expected —
  Waiting for status to be reported* mãi và nút merge bị khoá. (Admin bypass được, nhưng
  việc #1 chủ đích tắt bypass.)
- **Job bị bỏ qua bằng `if:` lại được tính là ĐẠT** (kết luận *skipped*). Đó là lý do PR
  nháp không bị khoá (job `changes` báo `run=false`, các job sau *skipped*) — và cũng là lỗ
  hổng: nếu chính job `Plan` **lỗi**, mọi job `needs: changes` bị *skipped* và… đạt. Năm
  check bắt buộc vẫn xanh trong khi không có test nào chạy.

Hai cách đúng (cả hai đều cần sửa `ci.yml` — tài liệu này chỉ đề xuất, chưa áp):

1. **(Khuyến nghị) Một job cổng duy nhất làm check bắt buộc.** Thêm job, ví dụ `CI gate`:
   `needs: [changes, unit-tests, integration-tests, schema-drift, build, hygiene]`,
   `if: always()`, và bước kiểm `needs.<job>.result` của từng job: `failure`/`cancelled`
   → thoát 1; `changes` phải `success`; các job khác chỉ được `success` hoặc `skipped`
   khi `changes` nói bỏ qua. Đặt **chỉ** `CI gate` là required. Đồng thời **bỏ
   `paths-ignore` của `pull_request`** (giữ cho `push`) để workflow luôn khởi động; muốn
   PR tài liệu vẫn rẻ thì để job `changes` xuất `run=false` khi mọi tệp đổi đều khớp
   `*.md|docs/|openspec/` — khi đó chỉ `Plan` + `CI gate` chạy (~1 phút billed).
   Ưu: một tên check ổn định, ma trận Integration không cần liệt kê, lỗi ở `Plan` làm đỏ
   cổng thay vì "skipped = đạt". Nhược: thêm một job (~vài giây) mỗi lượt PR.
2. **Giữ năm tên job làm required, bỏ `paths-ignore` của `pull_request`** và để job
   `changes` xuất `run=false` cho PR chỉ sửa tài liệu (các job còn lại *skipped* = đạt).
   Đơn giản hơn, nhưng giữ nguyên lỗ "Plan lỗi → mọi thứ skipped → đạt", và mỗi job mới
   thêm vào phải nhớ thêm vào danh sách required.

Trong lúc chưa sửa `ci.yml`: **đừng** bật required checks cho các tên job; chỉ bật "bắt
buộc qua pull request" + cấm push thẳng. Đừng bao giờ đặt check `Integration · …` là
bắt buộc (tên sinh theo ma trận; PR không đụng backend bỏ qua chúng). Integration vẫn chặn
deploy qua `needs` của job `image`.

### Khi cổng `npm audit` chặn một bản vá khẩn

Bước **"No known vulnerabilities in production dependencies"** (job `hygiene`,
`npm audit --omit=dev --audit-level=high`) chặn `image`/`deploy`. Một advisory mới công bố
sau giờ làm việc có thể chặn đúng bản vá cần lên ngay. Quy trình (không có cờ tắt trong
workflow — cổng có thể bị tắt là cổng không chặn gì):

1. Đọc advisory: gói nào, có thật sự chạy trong image runtime không (`npm ls <gói> --omit=dev`).
2. Nếu có bản vá: `npm install <gói>@<bản-vá> --package-lock-only --ignore-scripts` (hoặc
   `overrides` trong `package.json` cho phụ thuộc bắc cầu), đưa vào **cùng PR** với bản vá khẩn.
3. Nếu chưa có bản vá và bản vá khẩn không thể chờ: một PR riêng, có người duyệt, sửa đúng
   dòng đó thành `npm audit --omit=dev --audit-level=critical` **kèm chú thích ngày hết
   hạn + mã advisory**, merge, rồi PR hoàn nguyên ngay khi gói có bản vá. Không dùng
   `|| true`, không `continue-on-error`.

### Phạm vi shellcheck

Job `hygiene` có **hai** bước shellcheck (cùng action, ghim cùng SHA, `severity: warning`):

1. `scandir: ./scripts` — mỗi script một lượt.
2. `scandir: ./production`, `ignore_paths: production/lib`, `env: SHELLCHECK_OPTS: -x -a` —
   kiểm `production/manage.sh` và **mọi** `production/lib/*.sh` như MỘT chương trình, bắt đầu
   từ cửa vào. `manage.sh` nạp `lib/` bằng các dòng `.` có chỉ thị
   `# shellcheck source=lib/…` (+ `source-path=SCRIPTDIR`): `-x` **chỉ theo** các dòng đó
   để biết định nghĩa (biến của `common.sh` dùng ở lib khác không bị báo nhầm), còn cảnh
   báo **nằm trong** một lib chỉ được báo khi có thêm `-a` (`--check-sourced`). Thiếu `-a`
   thì một lỗi trong `lib/` im lặng — `-x` một mình trả 0 (đã thử: SC2128 cài vào
   `lib/deploy.sh`). Action không tự thêm hai cờ đó; chính shellcheck đọc `SHELLCHECK_OPTS`.
   `lib/` bị loại khỏi lượt tìm tệp vì kiểm một lib **một mình** là kiểm nó thiếu biến của
   `common.sh`. `.shellcheckrc` không thay được `-a` (đã thử `check-sourced=true`: không có tác dụng).

Kiểm tay khi sửa `manage.sh` hay một tệp `lib/` (cùng lệnh với CI):
`shellcheck -x -a -S warning production/manage.sh`, không cài được thì
`docker run --rm -v "$PWD:/mnt:ro" -w /mnt koalaman/shellcheck:stable -x -a -S warning production/manage.sh`
— hiện sạch cả ở mức `-S style` (2026-10-25). `tests/ops-scripts.test.ts` chạy đúng lệnh đó
khi máy có `shellcheck` (không có thì bỏ qua, in lệnh docker ở trên), chạy `bash -n` trên
từng tệp, và khoá cấu hình bước 2 ở trên. Hành vi được kiểm bằng
`tests/ops-scripts-sandbox.test.ts` / `tests/ops-migrate-scanner.test.ts` (chạy thật với
`docker`/`git`/`crontab` giả; Update tự chạy tiếp bằng bản mới qua `git pull` thật).

### Quyết định đã chốt (wave2): D2 và D-CI

Hai quyết định quy trình của đợt 2 — ghi ở đây để lượt rà sau không đề xuất lại như
việc còn thiếu.

**D2 — Không có cổng duyệt tay trước deploy** (việc #2 ở bảng trên giữ là *tuỳ chọn*).
Merge vào `main` vẫn tự deploy. Lớp chặn thay cho người bấm duyệt:
bảo vệ nhánh `main` + required checks (việc #1 — **việc của chủ repo**, chưa bật thì D2
không đứng vững), bản dump CSDL trước mỗi lượt đổi image (bước 2b), smoke test qua tên
miền thật (`VPS_SMOKE_URL`), lùi tự động khi container không khoẻ, và bỏ qua deploy khi
chỉ đổi tài liệu (*Mốc so của "chỉ tài liệu"*). Lý do không thêm cổng: một người vận hành,
mỗi lần merge phải bấm duyệt thì lượt chờ giữ chỗ trong nhóm `deploy-production` và bản vá
khẩn chậm theo người bấm. Đổi ý (thêm Environment `production` với *Required reviewers*)
là một dòng `environment: production` ở job `deploy` — không cần sửa gì khác.

**D-CI — Chấp nhận CI đầy đủ chạy hai lần mỗi lần merge** (một lượt ở PR, một lượt ở
push lên `main`), **khi repo còn public**: Actions không tính phút cho repo public, và lượt
push là lượt duy nhất dựng image + deploy, nên nó phải tự chạy đủ cổng
(`needs: [test, typecheck, build, hygiene]`). Kiểm `gh repo view --json visibility` ngày
2026-10-24: **PUBLIC** → giữ nguyên. **Nếu repo chuyển private** (hạn mức 3.000 phút/tháng
áp ngay; tài khoản từng hết phút khi còn private): lượt push lên `main` nên **dùng lại lượt
PR đã xanh của cùng tree SHA** (`git rev-parse HEAD^{tree}` khớp tree của commit đầu PR đã
qua đủ cổng) và chỉ build image + deploy — đó là việc còn mở, chưa viết, cần làm trước hoặc
ngay khi đổi visibility. Đổi visibility là quyết định của chủ repo.

---

## Xử lý sự cố

| Vấn đề | Nguyên nhân & cách xử lý |
|---|---|
| `thiếu VPS_SSH_KNOWN_HOSTS` | Chưa khai secret ở Bước 3 — job dừng trước khi ssh, chưa chạm vào VPS |
| `Host key verification failed` | Khoá máy chủ đã đổi (dựng lại VPS?). Chạy lại Bước 2 và cập nhật secret |
| `Permission denied (publickey)` | Khoá công khai chưa vào `authorized_keys`, hoặc `VPS_USER` sai. Thử `ssh -i ~/.ssh/cdkt_deploy <VPS_USER>@<VPS_HOST>` từ máy anh |
| `denied: permission_denied` lúc pull trên VPS | Chưa `docker login ghcr.io`, hoặc login bằng user khác `VPS_USER` — xem Bước 5 |
| `permission denied` khi gọi `docker` | User deploy chưa ở group `docker`: `sudo usermod -aG docker <user>` rồi đăng nhập lại |
| `không tìm thấy .env` | `VPS_APP_DIR` trỏ sai thư mục |
| VPS **tự build** thay vì dùng image kéo về | `docker-compose.yml` trên VPS còn là bản cũ, thiếu khoá `image:`. Từ khi CI tự gửi compose thì không còn xảy ra; nếu vẫn gặp, kiểm `.env` có đặt `COMPOSE_FILE` lạ không |
| `tệp compose nhận được bị hỏng trên đường truyền` | Phiên SSH gửi compose bị đứt. Chưa chạm gì trên VPS — chạy lại job |
| `… không qua docker compose config trên máy chủ này` | Compose mới cần thứ VPS chưa có: thường là một biến `${VAR:?…}` mới chưa có trong `.env`, hoặc Docker Compose trên VPS quá cũ. Đã trả bản cũ về, chưa chạm container. Đọc lỗi ngay trên dòng đó, sửa `.env`/nâng Compose, rồi chạy lại job |
| `git pull` trên VPS báo `docker-compose.yml` có thay đổi cục bộ | Đó là bản CI đặt vào (đã commit). `git checkout -- docker-compose.yml && git pull origin main` |
| Sửa compose của service `mysql` mà không thấy hiệu lực | Chủ đích: CI không tạo lại CSDL. Chạy `docker compose up -d` trên VPS khi thấp điểm |
| `chưa healthy sau 300s` | Đã tự lùi về image cũ, site vẫn chạy. Đọc log để tìm nguyên nhân: `docker logs cdkt_app --tail 100` |
| `đã khởi động lại N lần trong lúc chờ healthy — crash loop` | Image mới chết ngay khi khởi động; 60 dòng log in ngay dưới. Đã tự lùi. Thường là biến môi trường mới chưa có trong `.env` hoặc migration lỗi |
| `sao lưu CSDL trước deploy thất bại` | Dump trước deploy hỏng (đĩa đầy? `cdkt_mysql` không chạy? thiếu `MYSQL_ROOT_PASSWORD` trong `.env`?). **Chưa chạm gì** — compose, `.env`, container y như trước. Sửa nguyên nhân rồi *Re-run job*; cần gấp thì `./manage.sh` → Update (trả lời riêng câu sao lưu) |
| `script sao lưu nhận được bị hỏng trên đường truyền` | Phiên SSH gửi `backup-db.sh` bị đứt. Chưa chạm gì trên VPS — chạy lại job |
| Bước *Smoke test through the public URL* đỏ | Container trên VPS đã healthy nhưng địa chỉ công khai không trả đúng version sau 12 lần thử (~2 phút, tệ nhất ~4 phút): kiểm nginx/CDN/DNS, `curl -sL <VPS_SMOKE_URL>/api/public/health`. Không tự lùi; lùi tay theo § *Lùi phiên bản* nếu đúng là image hỏng |
| `::warning::chưa đặt biến repo VPS_SMOKE_URL` | Khai variable `VPS_SMOKE_URL` (Bước 3) để lượt deploy được xác nhận qua địa chỉ công khai |
| Merge chỉ sửa tài liệu mà không deploy | Đúng thiết kế: mọi tệp đổi **từ bản đang chạy** là `*.md`/`docs/`/`openspec/` (hoặc commit đó đã là bản đang chạy) → `image`/`deploy` bỏ qua. *Summary* của job Plan ghi mốc đã dùng (bản trên `VPS_SMOKE_URL` hay lượt deploy thành công gần nhất). Cần deploy lại cùng mã: Actions → CI → *Run workflow* trên `main` |
| `không có image trước đó để lùi về` | Lần deploy đầu tiên và nó hỏng. Sửa rồi deploy lại; chưa có gì để lùi về |
| `không khai HEALTHCHECK` | Container đang chạy image sai (không phải image của dự án). Kiểm `docker inspect --format '{{.Config.Image}}' cdkt_app` |
| Job `image` không chạy | Chỉ chạy trên `main`, không chạy cho pull request hay nhánh phụ — đúng thiết kế |
| Mọi khách có cùng một IP trong `activity_logs` | `TRUSTED_PROXY_IPS` sai hoặc chưa đặt — làm lại Bước 7 |

---

## Các tệp liên quan

| Tệp | Vai trò |
|---|---|
| `.github/workflows/ci.yml` | 4 cổng kiểm tra + job `image` + job `deploy` (kèm bước smoke) |
| `.github/workflows/ghcr-retention.yml` | Hằng tuần + bấm tay: giữ 20 version mới nhất của package image trên GHCR |
| `.github/dependabot.yml` | PR cập nhật hằng tuần, gộp nhóm (npm, Actions, base image) |
| `scripts/deploy-remote.sh` | Chạy **trên VPS**, nạp qua ssh stdin — kiểm tệp CI gửi, kéo image, dump CSDL trước deploy, đặt compose, đổi `.env`, chờ healthy (dừng sớm khi crash loop), lùi (image + compose) nếu hỏng, dọn image cũ |
| `scripts/backup-db.sh` | Dump + kiểm + xoay vòng; `--prefix cdkt-predeploy` cho bản dump trước deploy; ping `HEALTHCHECK_PING_URL` |
| `server/api/public/health.get.ts` | `GET /api/public/health` — `{ ok, version }`, `no-store`, 503 khi CSDL không trả lời trong 2 giây |
| `docker-compose.yml` | Khoá `image: ${CDKT_IMAGE:-cdkt/app:local}` cho phép vừa pull vừa build cục bộ; CI gửi tệp này lên VPS mỗi lượt deploy |
| `tests/ops-scripts.test.ts` | Chặn hồi quy: thứ tự cổng, ghim SHA, ghim host key, ghi `.env` nguyên tử, đường lùi phiên bản, thứ tự dump → compose → `.env`, bỏ qua deploy khi chỉ đổi tài liệu, smoke, giữ image; đọc `ci.yml`/compose bằng trình phân tích YAML cho `concurrency`, TZ, biến chuyển tiếp |
| `tests/deploy-remote-behavior.test.ts` | **Chạy thật** `deploy-remote.sh` (qua `bash -s` như CI) với `docker` giả (`tests/fixtures/deploy-remote/docker`): compose/script sao lưu hỏng/cụt bị từ chối mà `.env` không đổi, dump hỏng dừng trước mọi thay đổi, lùi trả cả image lẫn compose, `up` hỏng vẫn đi vào đường lùi, crash loop dừng chờ sau 3 lượt hỏi, mysql không bị tạo lại, 12 image → còn 6 |
| `tests/ci-docs-only-skip.test.ts` | **Chạy thật** script của bước *Docs-only?* trong một repo git tạm với `curl`/`gh` giả: so với bản đang chạy — chỉ tài liệu → không deploy; có `.ts` (kể cả đổi tên sang `docs/`) → deploy; push mã bị huỷ khi đang chờ rồi push tài liệu → vẫn deploy; thứ tự mốc (health → lượt có job deploy `success` → deploy); mốc không phải tổ tiên → deploy; đã chạy → không deploy |
| `tests/ci-integration-matrix.test.ts` | Mọi `tests/*-integration.test.ts` có trong matrix, đúng switch, đủ biến môi trường mà suite đọc; bước kiểm-skip đọc log, không chạy lại suite |
| `tests/schema-upgrade-integration.test.ts` + `tests/fixtures/schema-prev.sql` + `scripts/snapshot-schema.ts` | Khởi động bản mới hai lần trên lược đồ của bản đang chạy, với hàng đại diện ở mọi bảng migration đụng tới và mọi bảng seed ghi (hàng mang khoá default có giá trị đã sửa ở mọi cột seed ghi). Lượt 1 chỉ đổi qua chuyển đổi đã khai báo; một default seed thêm vào phải khớp đủ khoá **và** nội dung với dữ liệu của chính seed. Lượt 2 không đổi gì. Làm mới fixture: § *Làm mới fixture lược đồ của bản trước* |
| `tests/default-permission-matrix.test.ts` | Ghim ma trận quyền mặc định (vai trò → tài nguyên → quyền) mà `seed.ts` ghi. Đổi ma trận thì phải sửa test này trong cùng thay đổi. |
| `tests/container-timezone.test.ts` | Scheduler analytics/retention chạy ở `TZ=Asia/Ho_Chi_Minh` bắn lúc 03:00 giờ VN, ở UTC thì 10:00 giờ VN |

`deploy-remote.sh` được **nạp qua stdin** (`ssh ... "bash -s -- args" < scripts/deploy-remote.sh`)
chứ không gọi bản nằm sẵn trên VPS: máy chủ luôn chạy đúng phiên bản script của commit
đang được triển khai, không phải bản nào đó còn sót từ lần deploy trước.

---

## Phụ thuộc: `dependencies` = runtime, `devDependencies` = build

Image runtime (stage 2 của `Dockerfile`) chạy `npm ci --omit=dev --ignore-scripts`, nên **chỉ gói
trong `dependencies` được cài vào image**. `.output` của Nitro tự chứa (đã trace thứ nó cần),
còn các script chạy trong container (`db:init`, `db:seed`, `db:sanitize-html`,
`analytics:maintenance`…) chỉ import `drizzle-orm`, `mysql2`, `bcryptjs`, `jsonwebtoken`,
`sharp`, `h3`. Vì vậy `nuxt`, `vue`, `vue-router`, `tailwindcss`, `@nuxtjs/tailwindcss`,
`@nuxt/image`, `autoprefixer`, `hls.js`, `plyr`, `mermaid` nằm ở `devDependencies` (stage build
`npm ci` đầy đủ vẫn cài chúng cho `nuxi build`).

- **`--ignore-scripts` là bắt buộc ở stage runtime:** `postinstall` gốc là `nuxt prepare`, mà
  `nuxt` không có trong image runtime → không có cờ này `npm ci` thoát 127.
- **Thêm import mới trong `server/db/**`, `server/services/**` hoặc `scripts/**`** (được seed/script
  nạp) → gói đó phải ở `dependencies`, kể cả khi nó đã có sẵn "ké" qua `nuxt`. `h3` từng chỉ
  tới được nhờ `nuxt`; `seed.ts` → `services/languages.ts` import `createError` từ đó.
- **Mã nguồn trong image runtime:** `.output` + `server/`, `shared/`, `scripts/`, `public/`. Script
  chạy từ nguồn import tệp cùng repo bằng đường dẫn tương đối; thư mục nào nó tới mà image không
  COPY thì chết `ERR_MODULE_NOT_FOUND` **chỉ trong container** (`shared/` từng thiếu).
  `tests/runtime-image-sources.test.ts` dò đồ thị import và đỏ khi có lỗ (`app/` cố ý không copy:
  chỉ handler mà Nitro đã bundle vào `.output` tới nó).
- **Kiểm tra lỗ hổng:** `npm audit --omit=dev --audit-level=high` là bước **chặn** trong job `hygiene`
  (tập runtime hiện 0 advisory). `npm audit` toàn cây (gồm công cụ dev: nuxt → nitropack/simple-git…)
  vẫn báo, chỉ ghi log, không chặn. Tạo lại lockfile không cần cài gì:
  `npm install --package-lock-only --ignore-scripts`. Không dùng `npm audit fix --force`
  (npm đề xuất hạ `nuxt` xuống 3.7.4 — sai).
