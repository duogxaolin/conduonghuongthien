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
            job "deploy" → ssh vào VPS → docker pull → docker compose up -d
                         → chờ HEALTHCHECK → hỏng thì tự lùi về image trước
```

**Vì sao xây ở CI chứ không `git pull && docker compose build` trên VPS:** `nuxi build`
ngốn RAM, và trên VPS 1–2 GB nó bị OOM-kill giữa chừng — đúng lúc container cũ đã
dừng. Xây ở nơi khác thì một lần build hỏng **không chạm được** vào trang đang chạy,
và lùi phiên bản chỉ là trỏ lại tag cũ thay vì xây lại từ đầu.

**Vì sao hai job deploy nằm chung workflow với bốn cổng kiểm tra** (thay vì một
`workflow_run` riêng): để `needs: [test, typecheck, build, hygiene]` là một ràng buộc
của đồ thị phụ thuộc chứ không phải một lời hứa. Không có commit nào đi ra VPS mà
chưa qua đủ bốn cổng.

**Repo public thì Actions miễn phí không giới hạn phút**, nhưng package trên GHCR
**mặc định vẫn là private** — nên VPS bắt buộc phải `docker login` (Bước 4–5).

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
> **Cố ý không ghi giá trị thật vào đây.** Repo này public: địa chỉ máy chủ, cổng
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

⚠️ **Bước dễ bỏ sót nhất.** Script deploy **không** `git pull` — nó chỉ kéo image rồi
chạy `docker compose up -d app`, tức là dùng `docker-compose.yml` **đang nằm trên
VPS**. Bản cũ chưa có khoá `image:`, nên compose sẽ tự build tại chỗ thay vì dùng
image đã kéo về — đúng cái ta đang tránh.

```bash
cd <APP_DIR>
git pull origin main
grep -n 'CDKT_IMAGE' docker-compose.yml     # phải thấy: image: ${CDKT_IMAGE:-cdkt/app:local}
```

> Từ nay chỉ cần `git pull` lại khi `docker-compose.yml` hoặc cấu hình hạ tầng đổi.
> **Mã ứng dụng đi bằng image, không đi bằng git.**

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

# BẮT BUỘC khi có nginx/aaPanel đứng trước. Giá trị lấy từ lệnh inspect ở trên.
TRUSTED_PROXY_IPS=172.18.0.1
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
client_max_body_size 20M;
```

Thiếu `X-Forwarded-For` thì mọi khách trông như cùng một địa chỉ, và giới hạn tần
suất theo IP gộp thành một bucket chung cho cả internet.

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
| 5 | Repo trên VPS đã có khoá `image:` | `grep CDKT_IMAGE docker-compose.yml` |
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
sed -i 's|^CDKT_IMAGE=.*|CDKT_IMAGE=ghcr.io/<OWNER>/<REPO>:sha-<commit-cũ>|' .env
docker compose up -d app
docker inspect --format '{{.State.Health.Status}}' cdkt_app
```

Lấy danh sách image còn trên máy: `docker images ghcr.io/<OWNER>/<REPO>`.
Script deploy giữ lịch sử **7 ngày** (`docker image prune --filter until=168h`), cũ hơn
thì kéo lại từ GHCR.

### Lùi phiên bản tự động

Container mới không `healthy` trong 300 giây thì script tự trỏ `.env` về image cũ và
khởi động lại. Job vẫn **thất bại** (exit 1) kể cả khi lùi thành công — commit đó
không lên được thì không được báo là đã lên.

### Xoay khoá SSH

```bash
# máy anh
ssh-keygen -t ed25519 -f ~/.ssh/cdkt_deploy_new -N '' -C 'github-actions-deploy'
ssh-copy-id -i ~/.ssh/cdkt_deploy_new.pub -p <VPS_PORT> <VPS_USER>@<VPS_HOST>
# cập nhật secret VPS_SSH_KEY, chạy thử một lần deploy, rồi mới gỡ khoá cũ khỏi
# ~/.ssh/authorized_keys trên VPS
```

Gỡ khoá cũ **sau** khi đã có một lần deploy xanh bằng khoá mới — không phải trước.

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
| VPS **tự build** thay vì dùng image kéo về | `docker-compose.yml` trên VPS còn là bản cũ, thiếu khoá `image:` — làm Bước 6 |
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
| `scripts/deploy-remote.sh` | Chạy **trên VPS**, nạp qua ssh stdin — kéo image, đổi `.env`, chờ healthy, lùi nếu hỏng |
| `docker-compose.yml` | Khoá `image: ${CDKT_IMAGE:-cdkt/app:local}` cho phép vừa pull vừa build cục bộ |
| `tests/ops-scripts.test.ts` | Chặn hồi quy: thứ tự cổng, ghim SHA, ghim host key, ghi `.env` nguyên tử, đường lùi phiên bản |

`deploy-remote.sh` được **nạp qua stdin** (`ssh ... "bash -s -- args" < scripts/deploy-remote.sh`)
chứ không gọi bản nằm sẵn trên VPS: máy chủ luôn chạy đúng phiên bản script của commit
đang được triển khai, không phải bản nào đó còn sót từ lần deploy trước.
