/**
 * Backup & khôi phục — CSDL (mysqldump) + File (uploads + media) + Google Drive.
 *
 * Cùng tiền lệ `scripts/backup-db.sh` + `scripts/backup-media.sh` nhưng chạy từ
 * admin UI / scheduler, không cần SSH. Mysqldump + tar chạy trong app container
 * (Dockerfile thêm `mysql-client`); kết nối MySQL qua TCP (DB_HOST/DB_PORT).
 *
 * **Khoá MySQL `cdkt:backup:run`** (timeout 0) — 2 backup không chạy chồng.
 * **Khoá `cdkt:backup:restore`** — restore không chạy chồng backup.
 * **File hỏng → bỏ qua + log** — không rollback, đã backup xong là giữ.
 * **Xoay vòng N bản** — xoá bản cũ vượt N (mặc định 14) sau khi backup + Drive xong.
 *
 * Tệp này là **barrel**: API công khai của dịch vụ sao lưu, không có logic. Mọi nơi
 * gọi (endpoint, scheduler, khôi phục, các job media) import từ đây — và các test giả
 * `services/backup` ở đây. Phần thân (733 dòng, tách 2026-10-25) nằm ở:
 *   • `backup-names.ts` — trigger, mã thời điểm, `backupsDir()`, mẫu tên tệp của app,
 *     họ tệp, bản `pre-restore`
 *   • `backup-locks.ts` — khoá chạy/khôi phục, sổ tệp đang khôi phục, lỗi "bận"
 *   • `backup-run.ts` — `runBackup` + trạng thái chạy + đọc cấu hình
 *   • `backup-rotation.ts` — xoay vòng
 *   • `backup-sweep.ts` — dọn rác của lượt bị giết
 *   • `backup-catalog.ts` — danh sách + xoá cho trang quản trị
 * Các tệp con KHÔNG import tệp này (không vòng import); trạng thái cấp module có đúng
 * một chủ (`backup-run.ts`: trạng thái chạy; `backup-locks.ts`: sổ tệp đang khôi phục).
 * Liệt kê tên, không `export *`: tệp con export thêm hàm nội bộ cho nhau
 * (`deleteStaleFiles`, `restoreLockHeldOnServer`, `LOCK_RUN`), không phải API;
 * `tests/backup-service-api.test.ts` ghim đúng danh sách tên (giá trị lẫn kiểu).
 *
 * **Khôi phục** nằm ở `backup-restore.ts` (chỉ SuperAdmin — endpoint chặn);
 * dump/chạy SQL ở `backup-sql.ts`; kiểm file trước khi khôi phục ở
 * `backup-restore-guards.ts`; bản sao ngoài máy chủ ở `backup-offsite.ts`.
 */
export { BACKUP_TRIGGERS, backupFamilyOf, backupsDir, isPreRestoreBackup, timestampStamp } from './backup-names'
export type { BackupTrigger } from './backup-names'
export { BackupLockBusyError, BackupRestoreInProgressError, LOCK_RESTORE, holdRestoreTarget, restoreTargetsInProgress } from './backup-locks'
export { BackupNameCollisionError, defaultArchiveSources, getBackupStatus, readBackupConfig, runBackup } from './backup-run'
export type { ArchiveSource, BackupResult, BackupType, RunBackupOptions, RunStatus } from './backup-run'
export { rotateOldBackups, selectRotationVictims } from './backup-rotation'
export type { RotationGuards } from './backup-rotation'
export { sweepStaleBackupFiles } from './backup-sweep'
export { BackupDeleteError, deleteBackup, listBackups } from './backup-catalog'
