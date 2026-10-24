# 🔄 CI/CD Tự Động (GitHub Actions → GHCR → VPS)

Tài liệu vận hành cho việc triển khai tự động. Phần cài đặt VPS lần đầu (Docker,
`.env`, khởi tạo CSDL, sao lưu) nằm ở [DEPLOY.md](./DEPLOY.md).

---

## Luồng chạy

```
push main → test · typecheck · build · hygiene   (4 cổng, chạy song song)
              ↓ cả bốn xanh
            job "image"  → xây rồi đẩy ghcr.io/<owner>/<repo>:sha-<commit> + :latest
              ↓
            job "deploy" → ssh: gửi docker-compose.yml của commit này (kèm SHA-256)
                         → ssh: deploy-remote.sh → kiểm SHA-256 → docker pull
                         → sao lưu compose cũ → đặt compose mới → docker compose config -q
                           (sai → trả bản cũ, dừng, không chạm container)
                         → đổi CDKT_IMAGE trong .env → up -d --no-deps app
                         → chờ HEALTHCHECK → hỏng thì tự lùi về image + compose trước
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

**Tiết kiệm phút Actions** (hạn mức 3.000 phút/tháng áp cho repo private — repo này **đã chuyển sang private** (kiểm bằng `gh repo view` ngày 2026-10-22), nên hạn mức nay áp dụng; tài khoản từng hết phút): một lượt CI đầy đủ ≈ 40 phút
billed (GitHub làm tròn từng job lên phút; các job Integration chiếm ≈ 29 khi còn 13 job; nay matrix 18). Nên job
`changes` ("Plan") quyết định cho mỗi lượt chạy:

| Sự kiện | Chạy gì |
|---|---|
| push vào `main`, chạy tay (Actions → CI → Run workflow) | **Đủ bộ**, gồm Integration — `image`/`deploy` vẫn chờ mọi cổng |
| PR nháp | Bỏ qua (chạy lại khi bấm *Ready for review*) |
| PR thường | unit + build + schema-drift + hygiene (≈ 12 phút) |
| PR thường **có đụng** `server/`, `migrations/`, `scripts/`, `package*.json`, `nuxt.config.ts`, `.github/workflows/`, `tests/*integration*` | thêm 18 job Integration |

Muốn ép chạy đủ cho một PR chỉ-giao-diện: Actions → CI → *Run workflow* trên nhánh đó.
Gom commit trước khi push và dùng PR nháp cho việc dở dang cũng tiết kiệm phút.
Kiểm lượng đã dùng: GitHub → Settings → Billing and licensing → Usage.

Package trên GHCR **mặc định là private** (dù repo public hay private) — nên VPS
bắt buộc phải `docker login` (Bước 4–5). Khi repo còn public, Actions không tính
phút; từ khi chuyển private, mỗi lượt đủ bộ ăn vào hạn mức ở trên.

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
| `VPS_USER` | `root`, hoặc user đã thêm vào group `docker` |
| `VPS_SSH_KEY` | **toàn bộ nội dung** `~/.ssh/cdkt_deploy` (Bước 1) |
| `VPS_SSH_KNOWN_HOSTS` | 3 dòng `ssh-keyscan` ở Bước 2 |

**Variables** (tab *Variables*):

| Tên | Giá trị | Mặc định nếu bỏ trống |
|---|---|---|
| `VPS_PORT` | cổng SSH | `22` |
| `VPS_APP_DIR` | đường dẫn repo trên VPS, vd `/www/wwwroot/<tên-site>` | *(bắt buộc)* |

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

1. nhận tệp vào `<APP_DIR>/.docker-compose.incoming.yml`, kiểm **SHA-256** — tệp cụt
   do SSH đứt thì dừng trước cả `docker pull`;
2. `docker pull` image;
3. sao lưu `docker-compose.yml` cũ vào `<APP_DIR>/.deploy-compose-backups/`
   (giữ 10 bản gần nhất; compose không đổi thì không sao lưu, không ghi gì);
4. đặt bản mới, chạy `docker compose config -q` **trên chính VPS** (gồm cả
   `docker-compose.override.yml` nếu có, và bắt được biến bắt buộc mới mà `.env`
   chưa có) — sai thì trả bản cũ về và dừng, **chưa container nào, chưa dòng `.env`
   nào bị đụng**;
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
| 2 | 2 variable đã khai | `Settings → Variables` thấy `VPS_PORT`, `VPS_APP_DIR` |
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

### Lùi phiên bản

Tag `sha-<commit>` tồn tại cho **mọi** lần deploy, nên lùi được về bất kỳ commit nào:

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
Script deploy giữ lịch sử **7 ngày** (`docker image prune --filter until=168h`), cũ hơn
thì kéo lại từ GHCR.

### Lùi phiên bản tự động

Container mới không `healthy` trong 300 giây — hoặc chính lệnh `docker compose up`
hỏng — thì script trả `docker-compose.yml` về bản trước lượt này, trỏ `.env` về image
cũ và khởi động lại: image cũ chạy trên compose cũ, đúng cặp đã từng khoẻ. Job vẫn
**thất bại** (exit 1) kể cả khi lùi thành công — commit đó không lên được thì không
được báo là đã lên.

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
| 2 | *(Tuỳ chọn)* **Cổng duyệt tay trước deploy**: tạo Environment `production` với *Required reviewers*, rồi thêm `environment: production` vào job `deploy` (secret cấp repo vẫn dùng được trong job có environment). Workflow **cố ý chưa** có khoá này: đó là quyết định đổi quy trình (mỗi lần merge phải có người bấm duyệt, lượt chờ duyệt giữ chỗ trong nhóm `deploy-production`), không phải một sửa lỗi. | `Settings → Environments → New environment` |
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

Bước shellcheck trong `hygiene` chỉ quét `./scripts` (`scandir: ./scripts`).
`production/manage.sh` **không** được CI quét — action chỉ nhận một `scandir`, và đổi nó
thành `.` sẽ quét cả cây (kể cả fixture test) — nên nó được kiểm **tay**: hiện sạch ở mức
`-S warning` (2026-10-14). Khi sửa `manage.sh`, chạy
`shellcheck -S warning production/manage.sh` (không cài được thì
`docker run --rm -v "$PWD:/mnt:ro" -w /mnt koalaman/shellcheck:stable -S warning production/manage.sh`)
và `bash -n`. Một cảnh báo mới ở đây không làm đỏ CI — đừng để nó tích lại. Hành vi của nó được kiểm bằng
`tests/ops-scripts-sandbox.test.ts` / `tests/ops-migrate-scanner.test.ts` (chạy thật với
`docker`/`git` giả).

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
| `không có image trước đó để lùi về` | Lần deploy đầu tiên và nó hỏng. Sửa rồi deploy lại; chưa có gì để lùi về |
| `không khai HEALTHCHECK` | Container đang chạy image sai (không phải image của dự án). Kiểm `docker inspect --format '{{.Config.Image}}' cdkt_app` |
| Job `image` không chạy | Chỉ chạy trên `main`, không chạy cho pull request hay nhánh phụ — đúng thiết kế |
| Mọi khách có cùng một IP trong `activity_logs` | `TRUSTED_PROXY_IPS` sai hoặc chưa đặt — làm lại Bước 7 |

---

## Các tệp liên quan

| Tệp | Vai trò |
|---|---|
| `.github/workflows/ci.yml` | 4 cổng kiểm tra + job `image` + job `deploy` |
| `scripts/deploy-remote.sh` | Chạy **trên VPS**, nạp qua ssh stdin — kiểm + đặt compose, kéo image, đổi `.env`, chờ healthy, lùi (image + compose) nếu hỏng |
| `docker-compose.yml` | Khoá `image: ${CDKT_IMAGE:-cdkt/app:local}` cho phép vừa pull vừa build cục bộ; CI gửi tệp này lên VPS mỗi lượt deploy |
| `tests/ops-scripts.test.ts` | Chặn hồi quy: thứ tự cổng, ghim SHA, ghim host key, ghi `.env` nguyên tử, đường lùi phiên bản; đọc `ci.yml`/compose bằng trình phân tích YAML cho `concurrency`, TZ, biến chuyển tiếp |
| `tests/deploy-remote-behavior.test.ts` | **Chạy thật** `deploy-remote.sh` (qua `bash -s` như CI) với `docker` giả: compose hỏng/cụt bị từ chối mà `.env` không đổi, lùi trả cả image lẫn compose, `up` hỏng vẫn đi vào đường lùi, mysql không bị tạo lại |
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
- **Kiểm tra lỗ hổng:** `npm audit --omit=dev --audit-level=high` là bước **chặn** trong job `hygiene`
  (tập runtime hiện 0 advisory). `npm audit` toàn cây (gồm công cụ dev: nuxt → nitropack/simple-git…)
  vẫn báo, chỉ ghi log, không chặn. Tạo lại lockfile không cần cài gì:
  `npm install --package-lock-only --ignore-scripts`. Không dùng `npm audit fix --force`
  (npm đề xuất hạ `nuxt` xuống 3.7.4 — sai).
