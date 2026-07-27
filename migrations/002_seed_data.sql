-- ############################################################################
-- ##  CẢNH BÁO: ĐÂY LÀ BẢN MYSQLDUMP, KHÔNG PHẢI MIGRATION.                 ##
-- ##                                                                        ##
-- ##  Tệp này chứa lệnh DROP TABLE cho TOÀN BỘ bảng. Chạy nhầm lên cơ sở    ##
-- ##  dữ liệu đang hoạt động sẽ XOÁ SẠCH DỮ LIỆU.                           ##
-- ##                                                                        ##
-- ##  Nguồn schema chính thức:                                              ##
-- ##    - server/db/schema.ts  (khai bao Drizzle - nguon chan ly)           ##
-- ##    - server/db/init.ts    (DDL chay luc khoi dong, idempotent)         ##
-- ##                                                                        ##
-- ##  Khoi tao DB moi:  npm run db:init && npm run db:seed                  ##
-- ##                                                                        ##
-- ##  Chi dung tep nay khi CO Y khoi phuc toan bo tu snapshot:              ##
-- ##    mysql -u root -p \                                                  ##
-- ##      --init-command="SET @CDKT_ALLOW_DESTRUCTIVE_RESTORE=1" \          ##
-- ##      cdkt_admin < migrations/<ten-tep>.sql                             ##
-- ############################################################################

SELECT 'DUNG LAI: dump nay se XOA toan bo bang. Xem huong dan o dau tep.' AS canh_bao;

-- Guard: neu bien CDKT_ALLOW_DESTRUCTIVE_RESTORE chua duoc dat = 1, cau lenh
-- duoi day co y gay loi (subquery tra ve nhieu dong) de dung toan bo script.
SET @cdkt_guard = (
  SELECT CASE WHEN COALESCE(@CDKT_ALLOW_DESTRUCTIVE_RESTORE, 0) = 1
              THEN 1
              ELSE (SELECT 1 UNION ALL SELECT 2)
         END
);

-- MySQL dump 10.13  Distrib 8.0.46, for Linux (aarch64)
--
-- Host: localhost    Database: cdkt_admin
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Dumping data for table `roles`
--

LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` (`id`, `name`, `description`, `is_system`, `created_at`) VALUES (1,'superadmin','Toàn quyền hệ thống',1,'2026-07-21 08:32:43');
INSERT INTO `roles` (`id`, `name`, `description`, `is_system`, `created_at`) VALUES (2,'editor','Quản lý nội dung bài viết',0,'2026-07-21 08:32:43');
INSERT INTO `roles` (`id`, `name`, `description`, `is_system`, `created_at`) VALUES (3,'moderator','Xét duyệt và xem nội dung',0,'2026-07-21 08:32:43');
INSERT INTO `roles` (`id`, `name`, `description`, `is_system`, `created_at`) VALUES (4,'viewer','Chỉ xem submissions',0,'2026-07-21 08:32:43');
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `role_id`, `is_active`, `created_at`, `last_login_at`) VALUES (1,'admin','admin@conduonghuongthien.com.vn','$2b$12$c2SEtQRGIrGPUSX6OLt1B.T9xKgt8Z1UaZYIznJl46P17ImJGJIQG',1,1,'2026-07-21 08:32:44','2026-07-25 04:30:41');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `permissions`
--

LOCK TABLES `permissions` WRITE;
/*!40000 ALTER TABLE `permissions` DISABLE KEYS */;
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (1,1,'news',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (2,1,'role_models',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3,1,'reintegration',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (4,1,'documents',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (5,1,'faq',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (6,1,'home_sections',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (7,1,'users',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (8,1,'roles',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (9,1,'media',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (10,1,'settings',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (11,1,'submissions',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (23,3,'news',0,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (24,3,'role_models',0,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (25,3,'reintegration',0,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (26,3,'documents',0,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (27,3,'faq',0,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (28,3,'home_sections',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (29,3,'users',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (30,3,'roles',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (31,3,'media',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (32,3,'settings',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (33,3,'submissions',0,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (34,4,'news',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (35,4,'role_models',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (36,4,'reintegration',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (37,4,'documents',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (38,4,'faq',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (39,4,'home_sections',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (40,4,'users',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (41,4,'roles',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (42,4,'media',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (43,4,'settings',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (44,4,'submissions',0,1,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (309,2,'news',1,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (310,2,'role_models',1,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (311,2,'reintegration',1,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (312,2,'documents',1,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (313,2,'faq',1,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (314,2,'home_sections',0,1,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (315,2,'users',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (316,2,'roles',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (317,2,'media',1,1,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (318,2,'settings',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (319,2,'submissions',0,1,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3763,1,'analytics',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3764,1,'chatbot_settings',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3765,1,'chatbot_knowledge',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3777,2,'analytics',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3778,2,'chatbot_settings',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3779,2,'chatbot_knowledge',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3791,3,'analytics',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3792,3,'chatbot_settings',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3793,3,'chatbot_knowledge',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3805,4,'analytics',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3806,4,'chatbot_settings',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (3807,4,'chatbot_knowledge',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (5493,1,'categories',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (5508,2,'categories',1,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (5523,3,'categories',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (5538,4,'categories',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (5975,1,'pages',1,1,1,1,1,1,1);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (5991,2,'pages',1,1,1,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (6007,3,'pages',0,0,0,0,0,0,0);
INSERT INTO `permissions` (`id`, `role_id`, `resource`, `can_create`, `can_read`, `can_update`, `can_delete`, `can_publish`, `can_archive`, `can_test`) VALUES (6023,4,'pages',0,0,0,0,0,0,0);
/*!40000 ALTER TABLE `permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `settings`
--

LOCK TABLES `settings` WRITE;
/*!40000 ALTER TABLE `settings` DISABLE KEYS */;
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('address','Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội','string','contact');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('email','contact@conduonghuongthien.com.vn','string','contact');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('facebook_url','https://facebook.com','string','contact');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('hero_banner_url','/assets/hero_banner.jpg','string','general');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('hotline','0903.480.985','string','contact');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('logo_url','/Logo.png','string','general');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('media_provider','local','string','media');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('r2_access_key','','string','media');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('r2_account_id','','string','media');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('r2_bucket','','string','media');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('r2_public_url','','string','media');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('r2_secret_key','','string','media');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('site_description','Cổng thông tin hỗ trợ tái hòa nhập cộng đồng','string','general');
INSERT INTO `settings` (`key`, `value`, `type`, `group`) VALUES ('site_name','Con Đường Hướng Thiện','string','general');
/*!40000 ALTER TABLE `settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `content_types`
--

LOCK TABLES `content_types` WRITE;
/*!40000 ALTER TABLE `content_types` DISABLE KEYS */;
INSERT INTO `content_types` (`id`, `name`, `slug`, `icon`, `description`, `display_order`, `is_system`, `created_at`) VALUES (1,'Bản tin & Tin tức','news','fa-solid fa-newspaper',NULL,1,1,'2026-07-23 13:25:53');
INSERT INTO `content_types` (`id`, `name`, `slug`, `icon`, `description`, `display_order`, `is_system`, `created_at`) VALUES (2,'Tấm gương tiêu biểu','role_model','fa-solid fa-award',NULL,2,1,'2026-07-23 13:25:53');
INSERT INTO `content_types` (`id`, `name`, `slug`, `icon`, `description`, `display_order`, `is_system`, `created_at`) VALUES (3,'Mô hình tái hòa nhập','reintegration','fa-solid fa-people-roof',NULL,3,1,'2026-07-23 13:25:53');
INSERT INTO `content_types` (`id`, `name`, `slug`, `icon`, `description`, `display_order`, `is_system`, `created_at`) VALUES (4,'Văn bản pháp luật','document','fa-solid fa-file-lines',NULL,4,1,'2026-07-23 13:25:53');
INSERT INTO `content_types` (`id`, `name`, `slug`, `icon`, `description`, `display_order`, `is_system`, `created_at`) VALUES (5,'Giải đáp pháp luật','faq','fa-solid fa-circle-question',NULL,5,1,'2026-07-23 13:25:53');
/*!40000 ALTER TABLE `content_types` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `categories`
--

LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT INTO `categories` (`id`, `name`, `slug`, `parent_id`, `type`, `description`, `display_order`, `created_at`) VALUES (1,'Tin nổi bật','tin-noi-bat',NULL,'news',NULL,1,'2026-07-23 10:53:48');
INSERT INTO `categories` (`id`, `name`, `slug`, `parent_id`, `type`, `description`, `display_order`, `created_at`) VALUES (2,'Tin hoạt động','tin-hoat-dong',NULL,'news',NULL,2,'2026-07-23 10:53:48');
INSERT INTO `categories` (`id`, `name`, `slug`, `parent_id`, `type`, `description`, `display_order`, `created_at`) VALUES (3,'Tin địa phương','tin-dia-phuong',NULL,'news',NULL,3,'2026-07-23 10:53:48');
INSERT INTO `categories` (`id`, `name`, `slug`, `parent_id`, `type`, `description`, `display_order`, `created_at`) VALUES (4,'Tấm gương tiêu biểu','tam-guong-tieu-bieu',NULL,'role_model',NULL,1,'2026-07-23 10:53:48');
INSERT INTO `categories` (`id`, `name`, `slug`, `parent_id`, `type`, `description`, `display_order`, `created_at`) VALUES (5,'Mô hình tái hòa nhập','mo-hinh-tai-hoa-nhap',NULL,'reintegration',NULL,1,'2026-07-23 10:53:48');
INSERT INTO `categories` (`id`, `name`, `slug`, `parent_id`, `type`, `description`, `display_order`, `created_at`) VALUES (6,'Văn bản pháp luật','van-ban-phap-luat',NULL,'document',NULL,1,'2026-07-23 10:53:48');
INSERT INTO `categories` (`id`, `name`, `slug`, `parent_id`, `type`, `description`, `display_order`, `created_at`) VALUES (7,'Hỏi đáp pháp luật','hoi-dap-phap-luat',NULL,'faq',NULL,1,'2026-07-23 10:53:48');
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `pages`
--

LOCK TABLES `pages` WRITE;
/*!40000 ALTER TABLE `pages` DISABLE KEYS */;
INSERT INTO `pages` (`id`, `slug`, `title`, `is_system`, `seo_title`, `seo_description`, `updated_at`, `updated_by`, `draft_blocks`, `draft_updated_at`, `draft_updated_by`, `published_blocks`) VALUES (1,'home','Trang chủ',1,NULL,NULL,'2026-07-25 05:44:08',NULL,NULL,NULL,NULL,NULL);
INSERT INTO `pages` (`id`, `slug`, `title`, `is_system`, `seo_title`, `seo_description`, `updated_at`, `updated_by`, `draft_blocks`, `draft_updated_at`, `draft_updated_by`, `published_blocks`) VALUES (2,'about','Giới thiệu',1,NULL,NULL,'2026-07-25 05:49:18',NULL,NULL,NULL,NULL,NULL);
INSERT INTO `pages` (`id`, `slug`, `title`, `is_system`, `seo_title`, `seo_description`, `updated_at`, `updated_by`, `draft_blocks`, `draft_updated_at`, `draft_updated_by`, `published_blocks`) VALUES (3,'contact','Liên hệ',1,NULL,NULL,'2026-07-23 14:10:31',NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `pages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `page_blocks`
--

LOCK TABLES `page_blocks` WRITE;
/*!40000 ALTER TABLE `page_blocks` DISABLE KEYS */;
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (23,1,'hero',1,'{\"badge\": \"\", \"title\": \"Đồng hành cùng hành trình hướng thiện\", \"bgImage\": \"/assets/hero_banner.jpg\", \"btnHelp\": true, \"btnAbout\": true, \"subtitle\": \"Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý\"}',1,'2026-07-24 11:37:50',1);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (24,1,'stats',2,'{\"stats\": [{\"label\": \"Tỉnh / Thành phố đồng hành\", \"value\": \"34\"}, {\"label\": \"Người hoàn lương được hỗ trợ\", \"value\": \"10.000+\"}, {\"label\": \"Mô hình kinh tế tiêu biểu\", \"value\": \"500+\"}, {\"label\": \"Tư vấn pháp lý & Tâm lý miễn phí\", \"value\": \"24/7\"}]}',1,'2026-07-24 11:37:50',1);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (25,1,'news',3,'{\"title\": \"Tin nổi bật\", \"maxItems\": 5}',1,'2026-07-24 11:37:50',1);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (26,1,'role_models',4,'{\"title\": \"Tấm Gương Tiêu Biểu\", \"maxItems\": 3, \"subtitle\": \"Nghị lực vươn lên\"}',1,'2026-07-24 11:37:50',1);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (27,1,'reintegration',6,'{\"title\": \"Mô Hình Tái Hòa Nhập\", \"maxItems\": 3, \"subtitle\": \"Sinh kế bền vững\"}',1,'2026-07-24 20:44:55',1);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (28,1,'documents',7,'{\"title\": \"Văn bản Pháp luật Mới ban hành\", \"maxItems\": 6}',1,'2026-07-24 20:44:55',1);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (29,1,'support_form',8,'{\"title\": \"Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập\"}',1,'2026-07-24 20:44:55',1);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (30,1,'links',9,'{\"title\": \"Liên Kết Hữu Ích\"}',1,'2026-07-24 20:44:55',1);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (33,3,'heading',1,'{\"text\": \"Liên hệ & Trợ giúp\", \"align\": \"center\", \"bgImage\": \"/assets/hero_banner.jpg\", \"variant\": \"banner\", \"subtitle\": \"Hotline 0903.480.985 — Tiếp nhận yêu cầu trợ giúp 24/7\"}',1,'2026-07-24 12:05:11',NULL);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (34,3,'contact_form',2,'{\"title\": \"Gửi yêu cầu trợ giúp\", \"infoRows\": [{\"label\": \"Đơn vị chủ quản:\", \"value\": \"Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an\"}, {\"label\": \"Địa chỉ:\", \"value\": \"Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội\"}, {\"label\": \"Hotline:\", \"value\": \"0903.480.985\"}, {\"label\": \"Email:\", \"value\": \"contact@conduonghuongthien.com.vn\"}], \"noteText\": \"Hệ thống trợ giúp tiếp nhận yêu cầu 24/7 từ người chấp hành xong án phạt tù hoặc thân nhân của họ. Sau khi tiếp nhận thông tin, Ban Biên tập sẽ tiến hành bảo mật dữ liệu cá nhân, phân loại nghiệp vụ và chuyển giao nhanh chóng đến lực lượng Công an cấp cơ sở (xã, phường, thị trấn) hoặc ban ngành liên quan tại địa bàn bạn cư trú để hỗ trợ xử lý kịp thời.\", \"showInfo\": true, \"infoTitle\": \"Thông tin Ban Biên tập\", \"noteTitle\": \"Cơ chế trợ giúp\"}',1,'2026-07-24 12:05:11',NULL);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (35,2,'heading',1,'{\"text\": \"Giới thiệu\", \"align\": \"center\", \"bgImage\": \"/assets/hero_banner.jpg\", \"variant\": \"banner\", \"subtitle\": \"Ban Biên tập Cổng thông tin Con Đường Hướng Thiện\"}',1,'2026-07-24 13:10:43',NULL);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (36,2,'content_aside',2,'{\"icon\": \"fa-solid fa-building-columns\", \"title\": \"Ban Biên tập\", \"bodyHtml\": \"<h3>Mục đích hoạt động</h3><p>Trang thông tin điện tử <strong>Con Đường Hướng Thiện</strong> hoạt động dưới sự chỉ đạo của Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.</p><p>Mục tiêu tối thượng của nền tảng là cung cấp thông tin chính thống về các chính sách, nghị định của Đảng và Nhà nước liên quan đến công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng; tuyên truyền, nhân rộng các mô hình sản xuất kinh tế hiệu quả, các tấm gương điển hình tiên tiến hoàn lương lập nghiệp thành công; định hướng tư tưởng, pháp lý và kết nối hỗ trợ trực tuyến 24/7 giúp người lầm lỡ xóa bỏ tự ti, sớm ổn định cuộc sống.</p><h3>Nhiệm vụ trọng tâm</h3><ul><li><strong>Tuyên truyền &amp; Giáo dục pháp luật:</strong> Phổ biến các quy định về xóa án tích, chính sách vay vốn ưu đãi, quyền và nghĩa vụ công dân giúp người hoàn lương nâng cao hiểu biết pháp lý.</li><li><strong>Đào tạo &amp; Hướng nghiệp:</strong> Kết nối các cơ sở đào tạo nghề và các doanh nghiệp nhân văn nhằm tổ chức các lớp học nghề, tạo cơ hội việc làm công bằng cho người lầm lỡ.</li><li><strong>Tư vấn &amp; Trợ giúp trực tuyến:</strong> Xây dựng hệ thống giải đáp tự động và đường dây nóng tiếp nhận thông tin đăng ký hỗ trợ trực tiếp 24/7 trên phạm vi cả nước.</li></ul>\", \"asideNote\": \"Ban Biên Tập: Đại diện Cảnh sát Thi hành án hình sự & Hỗ trợ tư pháp công an các địa phương.\", \"asideLabel\": \"ĐƠN VỊ CHỦ QUẢN\", \"asideTitle\": \"Cục Cảnh sát QLTHG, TG và THAHS tại cộng đồng (C11)\", \"asideSubtitle\": \"Bộ Công an\", \"highlightLabel\": \"Hotline liên hệ trực tiếp:\", \"highlightValue\": \"0903.480.985\"}',1,'2026-07-24 13:10:43',NULL);
INSERT INTO `page_blocks` (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`, `updated_at`, `updated_by`) VALUES (37,1,'quote',5,'{\"cite\": \"— Đề án Tái hòa nhập cộng đồng, C11 Bộ Công an\", \"quote\": \"Mỗi con người lầm lỡ đều xứng đáng có một cơ hội thứ hai để hướng thiện. Sự chung tay, đồng hành của gia đình và toàn xã hội chính là ánh dương thắp sáng nẻo về lương thiện.\", \"bgImage\": \"/assets/hero_banner.jpg\"}',1,'2026-07-24 20:49:41',NULL);
/*!40000 ALTER TABLE `page_blocks` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `home_sections`
--

LOCK TABLES `home_sections` WRITE;
/*!40000 ALTER TABLE `home_sections` DISABLE KEYS */;
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (1,'hero',1,'{\"title\": \"Đồng hành cùng hành trình hướng thiện\", \"bgImage\": \"/assets/hero_banner.jpg\", \"btnHelp\": true, \"btnAbout\": true, \"subtitle\": \"Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý\"}',1,'2026-07-25 05:33:55',1);
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (2,'stats',2,'{\"stats\": [{\"label\": \"Tỉnh / Thành phố đồng hành\", \"value\": \"34\"}, {\"label\": \"Người hoàn lương được hỗ trợ\", \"value\": \"10.000+\"}, {\"label\": \"Mô hình kinh tế tiêu biểu\", \"value\": \"500+\"}, {\"label\": \"Tư vấn pháp lý & Tâm lý miễn phí\", \"value\": \"24/7\"}]}',1,'2026-07-21 08:34:19',1);
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (3,'news',3,'{\"title\": \"Tin nổi bật\", \"maxItems\": 5}',1,'2026-07-21 08:32:44',NULL);
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (4,'role_models',4,'{\"title\": \"Tấm Gương Tiêu Biểu\", \"maxItems\": 3, \"subtitle\": \"Nghị lực vươn lên\"}',1,'2026-07-21 08:32:44',NULL);
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (5,'reintegration',6,'{\"title\": \"Mô Hình Tái Hòa Nhập\", \"maxItems\": 3, \"subtitle\": \"Sinh kế bền vững\"}',1,'2026-07-24 20:48:20',NULL);
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (6,'documents',7,'{\"title\": \"Văn bản Pháp luật Mới ban hành\", \"maxItems\": 6}',1,'2026-07-24 20:48:20',NULL);
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (7,'support_form',8,'{\"title\": \"Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập\"}',1,'2026-07-24 20:48:20',NULL);
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (8,'links',9,'{\"title\": \"Liên Kết Hữu Ích\"}',1,'2026-07-24 20:48:20',NULL);
INSERT INTO `home_sections` (`id`, `type`, `display_order`, `config`, `is_visible`, `updated_at`, `updated_by`) VALUES (1237,'quote',5,'{\"cite\": \"— Đề án Tái hòa nhập cộng đồng, C11 Bộ Công an\", \"quote\": \"Mỗi con người lầm lỡ đều xứng đáng có một cơ hội thứ hai để hướng thiện. Sự chung tay, đồng hành của gia đình và toàn xã hội chính là ánh dương thắp sáng nẻo về lương thiện.\", \"bgImage\": \"/assets/hero_banner.jpg\"}',1,'2026-07-25 05:35:43',1);
/*!40000 ALTER TABLE `home_sections` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-25  5:49:36
