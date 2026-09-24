/**
 * Default UI translation seed data (~74 keys x 6 languages).
 * Grouped into logical categories for the admin translations editor.
 */

export interface DefaultTranslationSeedItem {
  group: string
  key: string
  values: Record<string, string>
}

export const DEFAULT_TRANSLATIONS_SEED: DefaultTranslationSeedItem[] = [
  {
    group: "nav",
    key: "home",
    values: {"vi":"Trang chủ","en":"Home","zh":"首页","fr":"Accueil","ru":"Главная","lo":"ໜ້າຫຼັກ"},
  },
  {
    group: "nav",
    key: "about",
    values: {"vi":"Giới thiệu","en":"About Us","zh":"关于我们","fr":"À propos","ru":"О портале","lo":"ກ່ຽວກັບພວກເຮົາ"},
  },
  {
    group: "nav",
    key: "news",
    values: {"vi":"Bản tin","en":"News","zh":"新闻动态","fr":"Actualités","ru":"Новости","lo":"ຂ່າວສານ"},
  },
  {
    group: "nav",
    key: "news_featured",
    values: {"vi":"Tin nổi bật","en":"Featured News","zh":"焦点新闻","fr":"À la une","ru":"Главные новости","lo":"ຂ່າວເດັ່ນ"},
  },
  {
    group: "nav",
    key: "news_activities",
    values: {"vi":"Tin hoạt động","en":"Activity News","zh":"工作动态","fr":"Activités","ru":"Деятельность","lo":"ຂ່າວກິດຈະກຳ"},
  },
  {
    group: "nav",
    key: "news_local",
    values: {"vi":"Tin địa phương","en":"Local News","zh":"地方动态","fr":"Actualités locales","ru":"Региональные новости","lo":"ຂ່າວທ້ອງຖິ່ນ"},
  },
  {
    group: "nav",
    key: "role_models",
    values: {"vi":"Tấm gương tiêu biểu","en":"Exemplary Models","zh":"先进典型","fr":"Modèles exemplaires","ru":"Примеры для подражания","lo":"ແບບຢ່າງທີ່ດີ"},
  },
  {
    group: "nav",
    key: "reintegration",
    values: {"vi":"Mô hình tái hòa nhập","en":"Reintegration Models","zh":"重返社会模式","fr":"Modèles de réinsertion","ru":"Модели реинтеграции","lo":"ຮູບແບບການກັບຄືນສູ່ສັງຄົມ"},
  },
  {
    group: "nav",
    key: "documents",
    values: {"vi":"Văn bản","en":"Docs","zh":"政策法规","fr":"Textes juridiques","ru":"Законодательство","lo":"ເອກະສານ"},
  },
  {
    group: "nav",
    key: "library",
    values: {"vi":"Thư viện","en":"Library","zh":"多媒体库","fr":"Médiathèque","ru":"Медиатека","lo":"ຫ້ອງສະໝຸດ"},
  },
  {
    group: "nav",
    key: "video_lib",
    values: {"vi":"Thư viện Video","en":"Video Gallery","zh":"视频库","fr":"Vidéothèque","ru":"Видеотека","lo":"ຫ້ອງສະໝຸດວິດີໂອ"},
  },
  {
    group: "nav",
    key: "photo_lib",
    values: {"vi":"Thư viện Ảnh","en":"Photo Gallery","zh":"图片库","fr":"Photothèque","ru":"Фотогалерея","lo":"ຫ້ອງສະໝຸດຮູບພາບ"},
  },
  {
    group: "nav",
    key: "media",
    values: {"vi":"Media","en":"Media","zh":"媒体中心","fr":"Médias","ru":"Медиа","lo":"ສື່ປະສົມ"},
  },
  {
    group: "nav",
    key: "faq",
    values: {"vi":"Giải đáp pháp luật","en":"Legal Q&A","zh":"法律问答","fr":"Questions juridiques","ru":"Правовые вопросы и ответы","lo":"ຖາມ-ຕອບ ກົດໝາຍ"},
  },
  {
    group: "nav",
    key: "faq_articles",
    values: {"vi":"Bài giải đáp","en":"Q&A Articles","zh":"问答专栏","fr":"Articles Q&R","ru":"Статьи вопросов и ответов","lo":"ບົດຖາມ-ຕອບ"},
  },
  {
    group: "nav",
    key: "faq_approved_docs",
    values: {"vi":"Tài liệu Hỏi – Đáp","en":"Approved Q&A Documents","zh":"权威问答汇编","fr":"Recueil officiel Q&R","ru":"Официальный сборник ответов","lo":"ເອກະສານຖາມ-ຕອບ ທີ່ໄດ້ຮັບອະນຸມັດ"},
  },
  {
    group: "nav",
    key: "gov_citizen",
    values: {"vi":"Bộ với Công dân","en":"Ministry & Citizens","zh":"部门与民众","fr":"Ministère & Citoyens","ru":"Органы власти и граждане","lo":"ລັດຖະບານ ກັບ ປະຊາຊົນ"},
  },
  {
    group: "nav",
    key: "register_help",
    values: {"vi":"Đăng ký trợ giúp","en":"Request Assistance","zh":"在线申请援助","fr":"Demande d’assistance","ru":"Запрос помощи","lo":"ລົງທະບຽນຂໍຄວາມຊ່ວຍເຫຼືອ"},
  },
  {
    group: "nav",
    key: "procedures",
    values: {"vi":"Thủ tục hành chính","en":"Administrative Procedures","zh":"行政审批与流程","fr":"Procédures administratives","ru":"Административные процедуры","lo":"ຂັ້ນຕອນການບໍລິຫານ"},
  },
  {
    group: "nav",
    key: "contact",
    values: {"vi":"Liên hệ","en":"Contact Us","zh":"联系我们","fr":"Contact","ru":"Контакты","lo":"ຕິດຕໍ່"},
  },
  {
    group: "nav",
    key: "support_247",
    values: {"vi":"Hỗ trợ 24/7","en":"24/7 Support","zh":"24/7 在线服务","fr":"Assistance 24/7","ru":"Круглосуточная помощь 24/7","lo":"ຊ່ວຍເຫຼືອ 24/7"},
  },
  {
    group: "nav",
    key: "hotline_lbl",
    values: {"vi":"Hotline Tư Vấn 24/7","en":"24/7 Hotline","zh":"24/7 热线电话","fr":"Ligne directe 24/7","ru":"Горячая линия 24/7","lo":"ສາຍດ່ວນໃຫ້ຄໍາປຶກສາ 24/7"},
  },
  {
    group: "nav",
    key: "ask_ai",
    values: {"vi":"Hỏi trợ lý","en":"AI Chat","zh":"AI 智能问答","fr":"Assistant IA","ru":"ИИ Ассистент","lo":"ຖາມຜູ້ຊ່ວຍ AI"},
  },
  {
    group: "nav",
    key: "categories",
    values: {"vi":"Danh mục","en":"Menu","zh":"","fr":"","ru":"","lo":"ໝວດໝູ່"},
  },
  {
    group: "nav",
    key: "language_switcher",
    values: {"vi":"Chọn ngôn ngữ","en":"Choose language","zh":"","fr":"","ru":"","lo":"ເລືອກພາສາ"},
  },
  {
    group: "nav",
    key: "search_open",
    values: {"vi":"Mở ô tìm kiếm","en":"Open search","zh":"","fr":"","ru":"","lo":"ເປີດຊ່ອງຄົ້ນຫາ"},
  },
  {
    group: "nav",
    key: "search_close",
    values: {"vi":"Đóng ô tìm kiếm","en":"Close search","zh":"","fr":"","ru":"","lo":"ປິດຊ່ອງຄົ້ນຫາ"},
  },
  {
    group: "nav",
    key: "menu_open",
    values: {"vi":"Mở menu","en":"Open menu","zh":"","fr":"","ru":"","lo":"ເປີດເມນູ"},
  },
  {
    group: "nav",
    key: "menu_close",
    values: {"vi":"Đóng menu","en":"Close menu","zh":"","fr":"","ru":"","lo":"ປິດເມນູ"},
  },
  {
    group: "nav",
    key: "search_placeholder",
    values: {"vi":"Tìm kiếm nội dung trên website...","en":"Search content on website...","zh":"","fr":"","ru":"","lo":"ຄົ້ນຫາເນື້ອໃນໃນເວັບໄຊ..."},
  },
  {
    group: "nav",
    key: "search_submit",
    values: {"vi":"Tìm kiếm","en":"Search","zh":"","fr":"","ru":"","lo":"ຄົ້ນຫາ"},
  },
  {
    group: "nav",
    key: "close",
    values: {"vi":"Đóng","en":"Close","zh":"","fr":"","ru":"","lo":"ປິດ"},
  },
  {
    group: "hero",
    key: "hero_badge",
    values: {"vi":"CỔNG THÔNG TIN C11 - BỘ CÔNG AN","en":"C11 PORTAL - MINISTRY OF PUBLIC SAFETY","zh":"","fr":"","ru":"","lo":"ປະຕູຂໍ້ມູນຂ່າວສານ C11 - ກະຊວງປ້ອງກັນຄວາມສະຫງົບ"},
  },
  {
    group: "hero",
    key: "hero_title",
    values: {"vi":"Đồng hành cùng hành trình hướng thiện","en":"Accompanying the Journey of Rehabilitation","zh":"","fr":"","ru":"","lo":"ຄຽງຂ້າງໃນເສັ້ນທາງແຫ່ງການເຮັດຄວາມດີ"},
  },
  {
    group: "hero",
    key: "hero_subtitle",
    values: {"vi":"Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý giúp người chấp hành xong án phạt tù vững vàng tái hòa nhập cộng đồng, xây dựng cuộc sống mới bền vững.","en":"A comprehensive platform offering vocational, legal, and psychological support to help former inmates reintegrate into society and build sustainable lives.","zh":"","fr":"","ru":"","lo":"ເວທີສະໜັບສະໜູນແບບຄົບວົງຈອນດ້ານອາຊີບ, ກົດໝາຍ ແລະ ຄໍາປຶກສາທາງຈິດວິທະຍາ ເພື່ອຊ່ວຍໃຫ້ຜູ້ທີ່ໄດ້ຮັບການປັບປຸງປະພຶດຄືນສູ່ສັງຄົມຢ່າງໝັ້ນຄົງ ແລະ ສ້າງຊີວິດໃໝ່ທີ່ຍືນຍົງ."},
  },
  {
    group: "hero",
    key: "hero_btn_about",
    values: {"vi":"Về chúng tôi","en":"About Us","zh":"","fr":"","ru":"","lo":"ກ່ຽວກັບພວກເຮົາ"},
  },
  {
    group: "hero",
    key: "hero_btn_help",
    values: {"vi":"Gửi yêu cầu trợ giúp","en":"Request Support","zh":"","fr":"","ru":"","lo":"ສົ່ງຄຳຮ້ອງຂໍຄວາມຊ່ວຍເຫຼືອ"},
  },
  {
    group: "stats",
    key: "stat_provinces_label",
    values: {"vi":"Tỉnh / Thành phố đồng hành","en":"Accompanying Provinces & Cities","zh":"","fr":"","ru":"","lo":"ແຂວງ / ນະຄອນທີ່ຮ່ວມມື"},
  },
  {
    group: "stats",
    key: "stat_reintegrated_label",
    values: {"vi":"Người hoàn lương được hỗ trợ","en":"Reintegrated Individuals Supported","zh":"","fr":"","ru":"","lo":"ຜູ້ກັບຄືນສູ່ສັງຄົມທີ່ໄດ້ຮັບການຊ່ວຍເຫຼືອ"},
  },
  {
    group: "stats",
    key: "stat_models_label",
    values: {"vi":"Mô hình kinh tế tiêu biểu","en":"Exemplary Economic Models","zh":"","fr":"","ru":"","lo":"ແບບຢ່າງເສດຖະກິດຕົວແບບ"},
  },
  {
    group: "stats",
    key: "stat_support_label",
    values: {"vi":"Tư vấn pháp lý & Tâm lý miễn phí","en":"Free Legal & Psychological Counseling","zh":"","fr":"","ru":"","lo":"ໃຫ້ຄຳປຶກສາດ້ານກົດໝາຍ & ຈິດວິທະຍາຟຣີ"},
  },
  {
    group: "news",
    key: "featured_news_title",
    values: {"vi":"Tin nổi bật","en":"Featured News","zh":"","fr":"","ru":"","lo":"ຂ່າວເດັ່ນ"},
  },
  {
    group: "news",
    key: "all_news",
    values: {"vi":"Tất cả tin tức →","en":"All News →","zh":"","fr":"","ru":"","lo":"ຂ່າວທັງໝົດ →"},
  },
  {
    group: "news",
    key: "local_police_news",
    values: {"vi":"Tin Công an Địa phương","en":"Local Police News","zh":"","fr":"","ru":"","lo":"ຂ່າວຕຳຫຼວດທ້ອງຖິ່ນ"},
  },
  {
    group: "news",
    key: "legal_warning_news",
    values: {"vi":"Cảnh báo & Phổ biến Pháp luật","en":"Warnings & Legal Dissemination","zh":"","fr":"","ru":"","lo":"ການເຕືອນ & ເຜີຍແຜ່ກົດໝາຍ"},
  },
  {
    group: "news",
    key: "role_models_title",
    values: {"vi":"Tấm Gương Tiêu Biểu","en":"Exemplary Role Models","zh":"","fr":"","ru":"","lo":"ບຸກຄົນຕົວແບບ"},
  },
  {
    group: "news",
    key: "role_models_subtitle",
    values: {"vi":"Nghị lực vươn lên","en":"Inspirational Resilience","zh":"","fr":"","ru":"","lo":"ຄວາມມານະພະຍາຍາມ"},
  },
  {
    group: "news",
    key: "reintegration_models_title",
    values: {"vi":"Mô Hình Tái Hòa Nhập","en":"Reintegration Models","zh":"","fr":"","ru":"","lo":"ແບບຢ່າງການກັບຄືນສູ່ສັງຄົມ"},
  },
  {
    group: "news",
    key: "reintegration_models_subtitle",
    values: {"vi":"Sinh kế bền vững","en":"Sustainable Livelihoods","zh":"","fr":"","ru":"","lo":"ການສ້າງອາຊີບທີ່ຍືນຍົງ"},
  },
  {
    group: "news",
    key: "view_detail",
    values: {"vi":"Xem chi tiết","en":"View Details","zh":"","fr":"","ru":"","lo":"ເບິ່ງລາຍລະອຽດ"},
  },
  {
    group: "news",
    key: "latest_docs_title",
    values: {"vi":"Văn bản Pháp luật Mới ban hành","en":"Newly Issued Legal Documents","zh":"","fr":"","ru":"","lo":"ເອກະສານກົດໝາຍທີ່ອອກໃໝ່"},
  },
  {
    group: "news",
    key: "view_all_docs",
    values: {"vi":"Tất cả văn bản →","en":"All Documents →","zh":"","fr":"","ru":"","lo":"ເອກະສານທັງໝົດ →"},
  },
  {
    group: "form",
    key: "support_form_title",
    values: {"vi":"Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập","en":"Register for Reintegration Counseling & Support","zh":"","fr":"","ru":"","lo":"ລົງທະບຽນຂໍຄຳປຶກສາ & ຊ່ວຍເຫຼືອການກັບຄືນສູ່ສັງຄົມ"},
  },
  {
    group: "form",
    key: "support_form_sub",
    values: {"vi":"Cán bộ C11 và ban cố vấn pháp lý sẽ bảo mật thông tin và liên hệ hỗ trợ bạn trong vòng 24 giờ.","en":"C11 officers and legal advisors will keep your information strictly confidential and contact you within 24 hours.","zh":"","fr":"","ru":"","lo":"ເຈົ້າໜ້າທີ່ C11 ແລະ ຄະນະທີ່ປຶກສາກົດໝາຍຈະຮັກສາຄວາມລັບຂອງຂໍ້ມູນ ແລະ ຕິດຕໍ່ຫາທ່ານພາຍໃນ 24 ຊົ່ວໂມງ."},
  },
  {
    group: "form",
    key: "form_name",
    values: {"vi":"Họ và tên người cần hỗ trợ *","en":"Full Name of Applicant *","zh":"","fr":"","ru":"","lo":"ຊື່ ແລະ ນາມສະກຸນ ຜູ້ທີ່ຕ້ອງການຄວາມຊ່ວຍເຫຼືອ *"},
  },
  {
    group: "form",
    key: "form_name_ph",
    values: {"vi":"Nhập đầy đủ họ và tên...","en":"Enter full name...","zh":"","fr":"","ru":"","lo":"ປ້ອນຊື່ ແລະ ນາມສະກຸນແບບເຕັມ..."},
  },
  {
    group: "form",
    key: "form_phone",
    values: {"vi":"Số điện thoại liên hệ *","en":"Contact Phone Number *","zh":"","fr":"","ru":"","lo":"ເບີໂທລະສັບຕິດຕໍ່ *"},
  },
  {
    group: "form",
    key: "form_phone_ph",
    values: {"vi":"Nhập số điện thoại...","en":"Enter phone number...","zh":"","fr":"","ru":"","lo":"ປ້ອນເບີໂທລະສັບ..."},
  },
  {
    group: "form",
    key: "form_city",
    values: {"vi":"Tỉnh / Thành phố *","en":"Province / City *","zh":"","fr":"","ru":"","lo":"ແຂວງ / ນະຄອນ *"},
  },
  {
    group: "form",
    key: "form_city_ph",
    values: {"vi":"Ví dụ: Đà Nẵng, Quảng Ninh...","en":"E.g., Da Nang, Quang Ninh...","zh":"","fr":"","ru":"","lo":"ຕົວຢ່າງ: ນະຄອນຫຼວງວຽງຈັນ, ຈັງຫວັດ..."},
  },
  {
    group: "form",
    key: "form_msg",
    values: {"vi":"Nội dung cần hỗ trợ (Vay vốn, Việc làm, Pháp lý...) *","en":"Support Needed (Loans, Jobs, Legal...) *","zh":"","fr":"","ru":"","lo":"ເນື້ອໃນທີ່ຕ້ອງການຄວາມຊ່ວຍເຫຼືອ (ກູ້ຢືມທຶນ, ວຽກເຮັດງານທຳ, ກົດໝາຍ...) *"},
  },
  {
    group: "form",
    key: "form_msg_ph",
    values: {"vi":"Mô tả cụ thể nguyện vọng của bạn...","en":"Describe your request specifically...","zh":"","fr":"","ru":"","lo":"ອະທິບາຍຄວາມຕ້ອງການຂອງທ່ານໃຫ້ລະອຽດ..."},
  },
  {
    group: "form",
    key: "form_submit",
    values: {"vi":"Gửi thông tin đăng ký","en":"Submit Registration","zh":"","fr":"","ru":"","lo":"ສົ່ງຂໍ້ມູນລົງທະບຽນ"},
  },
  {
    group: "form",
    key: "form_submitting",
    values: {"vi":"Đang gửi...","en":"Submitting...","zh":"","fr":"","ru":"","lo":"ກຳລັງສົ່ງ..."},
  },
  {
    group: "links",
    key: "useful_links_title",
    values: {"vi":"Liên Kết Hữu Ích","en":"Useful Links","zh":"","fr":"","ru":"","lo":"ລິ້ງທີ່ມີປະໂຫຍດ"},
  },
  {
    group: "links",
    key: "useful_links_sub",
    values: {"vi":"Liên kết Cổng thông tin","en":"Official Portal Links","zh":"","fr":"","ru":"","lo":"ລິ້ງເວັບໄຊທ໌ທາງການ"},
  },
  {
    group: "links",
    key: "gov_bca",
    values: {"vi":"Bộ Công an","en":"Ministry of Public Security","zh":"","fr":"","ru":"","lo":"ກະຊວງປ້ອງກັນຄວາມສະຫງົບ"},
  },
  {
    group: "links",
    key: "gov_dvc",
    values: {"vi":"Cổng Dịch vụ công Quốc gia","en":"National Public Service Portal","zh":"","fr":"","ru":"","lo":"ປະຕູການບໍລິການສາທາລະນະແຫ່ງຊາດ"},
  },
  {
    group: "links",
    key: "gov_vbsp",
    values: {"vi":"NH Chính sách Xã hội","en":"Social Policy Bank","zh":"","fr":"","ru":"","lo":"ທະນາຄານນະໂຍບາຍສັງຄົມ"},
  },
  {
    group: "links",
    key: "gov_molisa",
    values: {"vi":"Bộ Lao động - TB&XH","en":"Ministry of Labor - Invalids & Social Affairs","zh":"","fr":"","ru":"","lo":"ກະຊວງແຮງງານ ແລະ ສະຫວັດດີການສັງຄົມ"},
  },
  {
    group: "links",
    key: "gov_cand",
    values: {"vi":"Báo Công an Nhân dân","en":"","zh":"","fr":"","ru":"","lo":"ໜັງສືພິມຕຳຫຼວດປະຊາຊົນ"},
  },
  {
    group: "footer",
    key: "footer_about_desc",
    values: {"vi":"Trang thông tin điện tử dưới sự chỉ đạo sát sao của Bộ Công an, Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11).","en":"Electronic Information Portal under the direction of the Ministry of Public Security, C11 Department of Detention & Community Criminal Execution.","zh":"","fr":"","ru":"","lo":"ເວັບໄຊທ໌ຂໍ້ມູນຂ່າວສານ ພາຍໃຕ້ການຊີ້ນຳຢ່າງໃກ້ຊິດຂອງ ກະຊວງປ້ອງກັນຄວາມສະຫງົບ, ກົມຕຳຫຼວດຄຸ້ມຄອງຜູ້ຖືກກັກຕົວ, ຜູ້ຖືກຈຳຄຸກ ແລະ ການປະຕິບັດໂທດອາຍາໃນຊຸມຊົນ (C11)."},
  },
  {
    group: "footer",
    key: "footer_links_main",
    values: {"vi":"Liên kết chính","en":"Main Links","zh":"","fr":"","ru":"","lo":"ລິ້ງຫຼັກ"},
  },
  {
    group: "footer",
    key: "footer_links_reintegration",
    values: {"vi":"Tái hòa nhập","en":"Reintegration","zh":"","fr":"","ru":"","lo":"ການກັບຄືນສູ່ສັງຄົມ"},
  },
  {
    group: "footer",
    key: "footer_contact_info",
    values: {"vi":"Thông tin liên hệ","en":"Contact Information","zh":"","fr":"","ru":"","lo":"ຂໍ້ມູນຕິດຕໍ່"},
  },
  {
    group: "footer",
    key: "footer_agency",
    values: {"vi":"Cơ quan chủ quản:","en":"Managing Agency:","zh":"主管单位","fr":"Organisme de tutelle","ru":"Вышестоящий орган","lo":"ໜ່ວຍງານຮັບຜິດຊອບ:"},
  },
  {
    group: "footer",
    key: "footer_address",
    values: {"vi":"Địa chỉ:","en":"Address:","zh":"","fr":"","ru":"","lo":"ທີ່ຢູ່:"},
  },
  {
    group: "footer",
    key: "footer_phone",
    values: {"vi":"Điện thoại:","en":"Phone:","zh":"","fr":"","ru":"","lo":"ເບີໂທ:"},
  },
  {
    group: "footer",
    key: "footer_email",
    values: {"vi":"Email:","en":"Email:","zh":"","fr":"","ru":"","lo":"ອີເມວ:"},
  },
  {
    group: "footer",
    key: "footer_copyright",
    values: {"vi":"© 2026 Bản quyền thuộc về Cổng thông tin Con Đường Hướng Thiện - C11 Bộ Công an.","en":"© 2026 Copyright belong to Con Duong Huong Thien Portal - C11 Ministry of Public Security.","zh":"版权所有 © 2026 越南公安部 C11 局。保留所有权利。","fr":"Copyright © 2026 Département C11 - Ministère de la Sécurité publique. Tous droits réservés.","ru":"© 2026 Департамент C11 Министерства общественной безопасности. Все права защищены.","lo":"© 2026 ລິຂະສິດເປັນຂອງ ເວັບໄຊ Con Duong Huong Thien - ກົມ C11 ກະຊວງປ້ອງກັນຄວາມສະຫງົບ."},
  },
  {
    group: "footer",
    key: "footer_designer",
    values: {"vi":"Design by Delify.vn","en":"Design by Delify.vn","zh":"","fr":"","ru":"","lo":"Design by Delify.vn"},
  },
  {
    group: "chatbot",
    key: "bot_title",
    values: {"vi":"Trợ lý Pháp lý C11","en":"C11 Legal Assistant AI","zh":"","fr":"","ru":"","lo":"ຜູ້ຊ່ວຍດ້ານກົດໝາຍ C11"},
  },
  {
    group: "chatbot",
    key: "bot_status",
    values: {"vi":"Sẵn sàng giải đáp 24/7","en":"Ready 24/7","zh":"","fr":"","ru":"","lo":"ພ້ອມໃຫ້ບໍລິການ 24/7"},
  },
  {
    group: "chatbot",
    key: "bot_clear_history",
    values: {"vi":"Xóa lịch sử trò chuyện","en":"Clear Chat History","zh":"","fr":"","ru":"","lo":"ລຶບປະຫວັດການສົນທະນາ"},
  },
  {
    group: "chatbot",
    key: "bot_input_ph",
    values: {"vi":"Hỏi trợ lý về QĐ 22, thủ tục...","en":"Ask assistant about Decision 22, procedures...","zh":"","fr":"","ru":"","lo":"ຖາມຜູ້ຊ່ວຍກ່ຽວກັບ ຂໍ້ຕົກລົງ 22, ຂັ້ນຕອນ..."},
  },
  {
    group: "chatbot",
    key: "bot_teaser_badge",
    values: {"vi":"Gợi ý câu hỏi","en":"Suggested Question","zh":"","fr":"","ru":"","lo":"ຄຳແນະນຳຄຳຖາມ"},
  },
  {
    group: "chatbot",
    key: "bot_welcome",
    values: {"vi":"Xin chào! Tôi là Trợ lý ảo Hướng Thiện. Tôi có thể hỗ trợ bạn giải đáp nhanh các câu hỏi pháp lý đã được Cục C11 phê duyệt về công tác tái hòa nhập cộng đồng.","en":"Hello! I am Huong Thien AI Assistant. I can help answer legal questions approved by C11 regarding community reintegration.","zh":"","fr":"","ru":"","lo":"ສະບາຍດີ! ຂ້າພະເຈົ້າແມ່ນຜູ້ຊ່ວຍອັດຕະໂນມັດ Huong Thien. ຂ້າພະເຈົ້າສາມາດຊ່ວຍຕອບຄຳຖາມດ້ານກົດໝາຍທີ່ໄດ້ຮັບການອະນຸມັດຈາກ ກົມ C11 ກ່ຽວກັບວຽກງານການກັບຄືນສູ່ສັງຄົມ."},
  },
  {
    group: "about",
    key: "about_hero_title",
    values: {"vi":"Giới Thiệu","en":"About Us","zh":"","fr":"","ru":"","lo":"ແນະນຳ"},
  },
  {
    group: "about",
    key: "about_hero_sub",
    values: {"vi":"Tôn chỉ, mục đích hoạt động và chặng đường đồng hành cùng người hoàn lương","en":"Principles, operation goals, and journey of supporting reintegration","zh":"","fr":"","ru":"","lo":"ຫຼັກການ, ຈຸດປະສົງ ແລະ ເສັ້ນທາງການຮ່ວມທາງກັບຜູ້ທີ່ກັບຄືນສູ່ສັງຄົມ"},
  },
  {
    group: "about",
    key: "about_editorial",
    values: {"vi":"Về Ban Biên tập","en":"About the Editorial Board","zh":"","fr":"","ru":"","lo":"ກ່ຽວກັບຄະນະບັນນາທິການ"},
  },
  {
    group: "about",
    key: "about_purpose_title",
    values: {"vi":"Tôn chỉ & Mục đích","en":"Principles & Goals","zh":"","fr":"","ru":"","lo":"ຫຼັກການ & ຈຸດປະສົງ"},
  },
  {
    group: "about",
    key: "about_purpose_1",
    values: {"vi":"Trang thông tin điện tử Con Đường Hướng Thiện hoạt động dưới sự chỉ đạo của Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.","en":"The Con Duong Huong Thien Information Portal operates under the direction of C11 Department - Ministry of Public Security.","zh":"","fr":"","ru":"","lo":"ເວັບໄຊ Con Duong Huong Thien ດຳເນີນງານພາຍໃຕ້ການຊີ້ນຳຂອງ ກົມຕຳຫຼວດຄຸ້ມຄອງການກັກຕົວ, ການຂັງ ແລະ ການປະຕິບັດໂທດທາງອາຍາ (C11) - ກະຊວງປ້ອງກັນຄວາມສະຫງົບ."},
  },
  {
    group: "about",
    key: "about_purpose_2",
    values: {"vi":"Mục tiêu tối thượng của nền tảng là cung cấp thông tin chính thống về các chính sách, nghị định của Đảng và Nhà nước liên quan đến công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng; tuyên truyền, nhân rộng các mô hình sản xuất kinh tế hiệu quả, các tấm gương điển hình tiên tiến hoàn lương lập nghiệp thành công.","en":"The ultimate objective is to provide official information regarding policies and decrees related to criminal execution and community reintegration support.","zh":"","fr":"","ru":"","lo":"ເປົ້າໝາຍສູງສຸດຂອງເວທີນີ້ແມ່ນເພື່ອສະໜອງຂໍ້ມູນທີ່ເປັນທາງການກ່ຽວກັບນະໂຍບາຍ ແລະ ຂໍ້ຕົກລົງຂອງພັກ ແລະ ລັດ ທີ່ກ່ຽວຂ້ອງກັບການປະຕິບັດໂທດທາງອາຍາ ແລະ ການຊ່ວຍເຫຼືອການກັບຄືນສູ່ສັງຄົມ; ເຜີຍແຜ່ ແລະ ຂະຫຍາຍແບບຢ່າງການຜະລິດເສດຖະກິດທີ່ມີປະສິດທິພາບ ແລະ ບຸກຄົນຕົວແບບທີ່ກັບຄືນສູ່ສັງຄົມ ແລະ ສ້າງຕັ້ງຊີວິດໃໝ່ໄດ້ສໍາເລັດ."},
  },
  {
    group: "about",
    key: "about_tasks_title",
    values: {"vi":"Nhiệm vụ trọng tâm","en":"Key Responsibilities","zh":"","fr":"","ru":"","lo":"ພາລະກິດຕົ້ນຕໍ"},
  },
  {
    group: "contact",
    key: "contact_hero_title",
    values: {"vi":"Liên Hệ & Trợ Giúp","en":"Contact & Support","zh":"","fr":"","ru":"","lo":"ຕິດຕໍ່ & ຊ່ວຍເຫຼືອ"},
  },
  {
    group: "contact",
    key: "contact_hero_sub",
    values: {"vi":"Kết nối với ban biên tập và gửi thông tin yêu cầu trợ giúp trực tiếp","en":"Connect with the editorial board and submit direct support requests","zh":"","fr":"","ru":"","lo":"ເຊື່ອມຕໍ່ກັບຄະນະບັນນາທິການ ແລະ ສົ່ງຂໍ້ມູນຂໍຄວາມຊ່ວຍເຫຼືອໂດຍກົງ"},
  },
  {
    group: "contact",
    key: "contact_editorial_info",
    values: {"vi":"Thông tin liên hệ Ban Biên tập","en":"Editorial Board Contact Info","zh":"","fr":"","ru":"","lo":"ຂໍ້ມູນຕິດຕໍ່ຄະນະບັນນາທິການ"},
  },
  {
    group: "contact",
    key: "contact_support_mechanism",
    values: {"vi":"Cơ chế hỗ trợ","en":"Support Mechanism","zh":"","fr":"","ru":"","lo":"ກົນໄກການຊ່ວຍເຫຼືອ"},
  },
  {
    group: "contact",
    key: "contact_form_heading",
    values: {"vi":"Gửi Yêu Cầu Trợ Giúp Hoặc Ý Kiến Đóng Góp","en":"Submit Support Request or Feedback","zh":"","fr":"","ru":"","lo":"ສົ່ງຄຳຮ້ອງຂໍຄວາມຊ່ວຍເຫຼືອ ຫຼື ຄຳຄິດເຫັນ"},
  },
  {
    group: "legal",
    key: "qa_hero_title",
    values: {"vi":"Giải Đáp Pháp Luật Trực Tuyến","en":"Online Legal Q&A","zh":"","fr":"","ru":"","lo":"ຕອບຄຳຖາມກົດໝາຍອອນລາຍ"},
  },
  {
    group: "legal",
    key: "qa_hero_sub",
    values: {"vi":"Tra cứu nhanh các thắc mắc về thi hành án hình sự, tín dụng ưu đãi QĐ 22 và xóa án tích","en":"Quickly look up inquiries about criminal execution, Decision 22 credit loans, and criminal record clearance","zh":"","fr":"","ru":"","lo":"ຄົ້ນຫາຂໍ້ມູນໄວກ່ຽວກັບການປະຕິບັດໂທດທາງອາຍາ, ສິນເຊື່ອ ưu đãi ຕາມຂໍ້ຕົກລົງ 22 ແລະ ການລຶບປະຫວັດອາຍາ"},
  },
  {
    group: "legal",
    key: "doc_hero_title",
    values: {"vi":"Văn Bản Pháp Luật & Thủ Tục","en":"Legal Documents & Procedures","zh":"","fr":"","ru":"","lo":"ເອກະສານກົດໝາຍ & ຂັ້ນຕອນ"},
  },
  {
    group: "legal",
    key: "doc_hero_sub",
    values: {"vi":"Hệ thống các Nghị định, Quyết định và hướng dẫn thi hành mới nhất của Bộ Công an và Chính phủ","en":"System of latest Decrees, Decisions, and execution guidelines by the Government and Ministry of Public Security","zh":"","fr":"","ru":"","lo":"ລະບົບຂໍ້ຕົກລົງ, ຂໍ້ບັງຄັບ ແລະ ຄຳແນະນຳການຈັດຕັ້ງປະຕິບັດຫຼ້າສຸດຈາກ ກະຊວງປ້ອງກັນຄວາມສະຫງົບ ແລະ ລັດຖະບານ"},
  },
  {
    group: "legal",
    key: "doc_search_ph",
    values: {"vi":"Nhập số hiệu, tên văn bản...","en":"Enter document number or title...","zh":"","fr":"","ru":"","lo":"ປ້ອນເລກທີ, ຊື່ເອກະສານ..."},
  },
  {
    group: "legal",
    key: "doc_table_num",
    values: {"vi":"Số hiệu / Ký hiệu","en":"Document No. / Code","zh":"","fr":"","ru":"","lo":"ເລກທີ / ສັນຍະລັກ"},
  },
  {
    group: "legal",
    key: "doc_table_date",
    values: {"vi":"Ngày ban hành","en":"Issued Date","zh":"","fr":"","ru":"","lo":"ວັນທີປະກາດໃຊ້"},
  },
  {
    group: "legal",
    key: "doc_table_title",
    values: {"vi":"Tên văn bản","en":"Document Title","zh":"","fr":"","ru":"","lo":"ຊື່ເອກະສານ"},
  },
  {
    group: "legal",
    key: "doc_table_action",
    values: {"vi":"Tải về / Thao tác","en":"Download / Actions","zh":"","fr":"","ru":"","lo":"ດາວໂຫຼດ / ດຳເນີນການ"},
  },
];
