import { useState } from '#imports'

export const useI18n = () => {
  const currentLang = useState<string>('currentLang', () => 'VN')
  const fontSize = useState<string>('fontSize', () => 'normal')

  const dictionary: Record<string, Record<string, string>> = {
    VN: {
      // Header & Nav
      home: 'Trang chủ',
      about: 'Giới thiệu',
      news: 'Bản tin',
      news_featured: 'Tin nổi bật',
      news_activities: 'Tin hoạt động',
      news_local: 'Tin địa phương',
      role_models: 'Tấm gương tiêu biểu',
      reintegration: 'Mô hình tái hòa nhập',
      documents: 'Văn bản',
      library: 'Thư viện',
      video_lib: 'Thư viện Video',
      photo_lib: 'Thư viện Ảnh',
      faq: 'Giải đáp pháp luật',
      gov_citizen: 'Bộ với Công dân',
      register_help: 'Đăng ký trợ giúp',
      procedures: 'Thủ tục hành chính',
      contact: 'Liên hệ',
      support_247: 'Hỗ trợ 24/7',
      font_size: 'Cỡ chữ:',
      hotline_lbl: 'Hotline Tư Vấn 24/7',
      ask_ai: 'Hỏi trợ lý',
      categories: 'Danh mục',
      search_placeholder: 'Tìm kiếm nội dung trên website...',
      search_submit: 'Tìm kiếm',
      close: 'Đóng',

      // Hero Section
      hero_badge: 'CỔNG THÔNG TIN C11 - BỘ CÔNG AN',
      hero_title: 'Đồng hành cùng hành trình hướng thiện',
      hero_subtitle: 'Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý giúp người chấp hành xong án phạt tù vững vàng tái hòa nhập cộng đồng, xây dựng cuộc sống mới bền vững.',
      hero_btn_about: 'Về chúng tôi',
      hero_btn_help: 'Gửi yêu cầu trợ giúp',

      // Stats Section
      stat_provinces_label: 'Tỉnh / Thành phố đồng hành',
      stat_reintegrated_label: 'Người hoàn lương được hỗ trợ',
      stat_models_label: 'Mô hình kinh tế tiêu biểu',
      stat_support_label: 'Tư vấn pháp lý & Tâm lý miễn phí',

      // News & Sections
      featured_news_title: 'Tin nổi bật',
      all_news: 'Tất cả tin tức →',
      local_police_news: 'Tin Công an Địa phương',
      legal_warning_news: 'Cảnh báo & Phổ biến Pháp luật',
      role_models_title: 'Tấm Gương Tiêu Biểu',
      role_models_subtitle: 'Nghị lực vươn lên',
      reintegration_models_title: 'Mô Hình Tái Hòa Nhập',
      reintegration_models_subtitle: 'Sinh kế bền vững',
      view_detail: 'Xem chi tiết',
      latest_docs_title: 'Văn bản Pháp luật Mới ban hành',
      view_all_docs: 'Tất cả văn bản →',

      // Support Form
      support_form_title: 'Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập',
      support_form_sub: 'Cán bộ C11 và ban cố vấn pháp lý sẽ bảo mật thông tin và liên hệ hỗ trợ bạn trong vòng 24 giờ.',
      form_name: 'Họ và tên người cần hỗ trợ *',
      form_name_ph: 'Nhập đầy đủ họ và tên...',
      form_phone: 'Số điện thoại liên hệ *',
      form_phone_ph: 'Nhập số điện thoại...',
      form_city: 'Tỉnh / Thành phố *',
      form_city_ph: 'Ví dụ: Đà Nẵng, Quảng Ninh...',
      form_msg: 'Nội dung cần hỗ trợ (Vay vốn, Việc làm, Pháp lý...) *',
      form_msg_ph: 'Mô tả cụ thể nguyện vọng của bạn...',
      form_submit: 'Gửi thông tin đăng ký',
      form_submitting: 'Đang gửi...',

      // Partner links
      useful_links_title: 'Liên Kết Hữu Ích',
      useful_links_sub: 'Liên kết Cổng thông tin',
      gov_bca: 'Bộ Công an',
      gov_dvc: 'Cổng Dịch vụ công Quốc gia',
      gov_vbsp: 'NH Chính sách Xã hội',
      gov_molisa: 'Bộ Lao động - TB&XH',
      gov_cand: 'Báo Công an Nhân dân',

      // Footer
      footer_about_desc: 'Trang thông tin điện tử dưới sự chỉ đạo sát sao của Bộ Công an, Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11).',
      footer_links_main: 'Liên kết chính',
      footer_links_reintegration: 'Tái hòa nhập',
      footer_contact_info: 'Thông tin liên hệ',
      footer_agency: 'Cơ quan chủ quản:',
      footer_address: 'Địa chỉ:',
      footer_phone: 'Điện thoại:',
      footer_email: 'Email:',
      footer_copyright: '© 2026 Bản quyền thuộc về Cổng thông tin Con Đường Hướng Thiện - C11 Bộ Công an.',
      footer_designer: 'Design by Delify.vn',

      // Chatbot
      bot_title: 'Trợ lý Pháp lý C11',
      bot_status: 'Sẵn sàng giải đáp 24/7',
      bot_clear_history: 'Xóa lịch sử trò chuyện',
      bot_input_ph: 'Hỏi trợ lý về QĐ 22, thủ tục...',
      bot_teaser_badge: 'Gợi ý câu hỏi',
      bot_welcome: 'Xin chào! Tôi là Trợ lý ảo Hướng Thiện. Tôi có thể hỗ trợ bạn giải đáp nhanh các câu hỏi pháp lý đã được Cục C11 phê duyệt về công tác tái hòa nhập cộng đồng.',

      // About Page
      about_hero_title: 'Giới Thiệu Ban Biên Tập',
      about_hero_sub: 'Tôn chỉ, mục đích hoạt động và chặng đường đồng hành cùng người hoàn lương',
      about_editorial: 'Về Ban Biên tập',
      about_purpose_title: 'Tôn chỉ & Mục đích',
      about_purpose_1: 'Trang thông tin điện tử Con Đường Hướng Thiện hoạt động dưới sự chỉ đạo của Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.',
      about_purpose_2: 'Mục tiêu tối thượng của nền tảng là cung cấp thông tin chính thống về các chính sách, nghị định của Đảng và Nhà nước liên quan đến công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng; tuyên truyền, nhân rộng các mô hình sản xuất kinh tế hiệu quả, các tấm gương điển hình tiên tiến hoàn lương lập nghiệp thành công.',
      about_tasks_title: 'Nhiệm vụ trọng tâm',

      // Contact Page
      contact_hero_title: 'Liên Hệ & Trợ Giúp',
      contact_hero_sub: 'Kết nối với ban biên tập và gửi thông tin yêu cầu trợ giúp trực tiếp',
      contact_editorial_info: 'Thông tin liên hệ Ban Biên tập',
      contact_support_mechanism: 'Cơ chế hỗ trợ',
      contact_form_heading: 'Gửi Yêu Cầu Trợ Giúp Hoặc Ý Kiến Đóng Góp',

      // Legal & Q&A Pages
      qa_hero_title: 'Giải Đáp Pháp Luật Trực Tuyến',
      qa_hero_sub: 'Tra cứu nhanh các thắc mắc về thi hành án hình sự, tín dụng ưu đãi QĐ 22 và xóa án tích',
      doc_hero_title: 'Văn Bản Pháp Luật & Thủ Tục',
      doc_hero_sub: 'Hệ thống các Nghị định, Quyết định và hướng dẫn thi hành mới nhất của Bộ Công an và Chính phủ',
      doc_search_ph: 'Nhập số hiệu, tên văn bản...',
      doc_table_num: 'Số hiệu / Ký hiệu',
      doc_table_date: 'Ngày ban hành',
      doc_table_title: 'Tên văn bản',
      doc_table_action: 'Tải về / Thao tác'
    },
    EN: {
      // Header & Nav
      home: 'Home',
      about: 'About Us',
      news: 'News',
      news_featured: 'Featured News',
      news_activities: 'Activity News',
      news_local: 'Local News',
      role_models: 'Exemplary Models',
      reintegration: 'Reintegration Models',
      documents: 'Legal Documents',
      library: 'Library',
      video_lib: 'Video Gallery',
      photo_lib: 'Photo Gallery',
      faq: 'Legal Q&A',
      gov_citizen: 'Ministry & Citizens',
      register_help: 'Request Assistance',
      procedures: 'Administrative Procedures',
      contact: 'Contact Us',
      support_247: '24/7 Support',
      font_size: 'Font size:',
      hotline_lbl: '24/7 Hotline',
      ask_ai: 'Ask Assistant',
      categories: 'Menu',
      search_placeholder: 'Search content on website...',
      search_submit: 'Search',
      close: 'Close',

      // Hero Section
      hero_badge: 'C11 PORTAL - MINISTRY OF PUBLIC SAFETY',
      hero_title: 'Accompanying the Journey of Rehabilitation',
      hero_subtitle: 'A comprehensive platform offering vocational, legal, and psychological support to help former inmates reintegrate into society and build sustainable lives.',
      hero_btn_about: 'About Us',
      hero_btn_help: 'Request Support',

      // Stats Section
      stat_provinces_label: 'Accompanying Provinces & Cities',
      stat_reintegrated_label: 'Reintegrated Individuals Supported',
      stat_models_label: 'Exemplary Economic Models',
      stat_support_label: 'Free Legal & Psychological Counseling',

      // News & Sections
      featured_news_title: 'Featured News',
      all_news: 'All News →',
      local_police_news: 'Local Police News',
      legal_warning_news: 'Warnings & Legal Dissemination',
      role_models_title: 'Exemplary Role Models',
      role_models_subtitle: 'Inspirational Resilience',
      reintegration_models_title: 'Reintegration Models',
      reintegration_models_subtitle: 'Sustainable Livelihoods',
      view_detail: 'View Details',
      latest_docs_title: 'Newly Issued Legal Documents',
      view_all_docs: 'All Documents →',

      // Support Form
      support_form_title: 'Register for Reintegration Counseling & Support',
      support_form_sub: 'C11 officers and legal advisors will keep your information strictly confidential and contact you within 24 hours.',
      form_name: 'Full Name of Applicant *',
      form_name_ph: 'Enter full name...',
      form_phone: 'Contact Phone Number *',
      form_phone_ph: 'Enter phone number...',
      form_city: 'Province / City *',
      form_city_ph: 'E.g., Da Nang, Quang Ninh...',
      form_msg: 'Support Needed (Loans, Jobs, Legal...) *',
      form_msg_ph: 'Describe your request specifically...',
      form_submit: 'Submit Registration',
      form_submitting: 'Submitting...',

      // Partner links
      useful_links_title: 'Useful Links',
      useful_links_sub: 'Official Portal Links',
      gov_bca: 'Ministry of Public Security',
      gov_dvc: 'National Public Service Portal',
      gov_vbsp: 'Social Policy Bank',
      gov_molisa: 'Ministry of Labor - Invalids & Social Affairs',
      gov_cand: 'People’s Public Security Newspaper',

      // Footer
      footer_about_desc: 'Electronic Information Portal under the direction of the Ministry of Public Security, C11 Department of Detention & Community Criminal Execution.',
      footer_links_main: 'Main Links',
      footer_links_reintegration: 'Reintegration',
      footer_contact_info: 'Contact Information',
      footer_agency: 'Managing Agency:',
      footer_address: 'Address:',
      footer_phone: 'Phone:',
      footer_email: 'Email:',
      footer_copyright: '© 2026 Copyright belong to Con Duong Huong Thien Portal - C11 Ministry of Public Security.',
      footer_designer: 'Design by Delify.vn',

      // Chatbot
      bot_title: 'C11 Legal Assistant AI',
      bot_status: 'Ready 24/7',
      bot_clear_history: 'Clear Chat History',
      bot_input_ph: 'Ask assistant about Decision 22, procedures...',
      bot_teaser_badge: 'Suggested Question',
      bot_welcome: 'Hello! I am Huong Thien AI Assistant. I can help answer legal questions approved by C11 regarding community reintegration.',

      // About Page
      about_hero_title: 'Editorial Board Overview',
      about_hero_sub: 'Principles, operation goals, and journey of supporting reintegration',
      about_editorial: 'About the Editorial Board',
      about_purpose_title: 'Principles & Goals',
      about_purpose_1: 'The Con Duong Huong Thien Information Portal operates under the direction of C11 Department - Ministry of Public Security.',
      about_purpose_2: 'The ultimate objective is to provide official information regarding policies and decrees related to criminal execution and community reintegration support.',
      about_tasks_title: 'Key Responsibilities',

      // Contact Page
      contact_hero_title: 'Contact & Support',
      contact_hero_sub: 'Connect with the editorial board and submit direct support requests',
      contact_editorial_info: 'Editorial Board Contact Info',
      contact_support_mechanism: 'Support Mechanism',
      contact_form_heading: 'Submit Support Request or Feedback',

      // Legal & Q&A Pages
      qa_hero_title: 'Online Legal Q&A',
      qa_hero_sub: 'Quickly look up inquiries about criminal execution, Decision 22 credit loans, and criminal record clearance',
      doc_hero_title: 'Legal Documents & Procedures',
      doc_hero_sub: 'System of latest Decrees, Decisions, and execution guidelines by the Government and Ministry of Public Security',
      doc_search_ph: 'Enter document number or title...',
      doc_table_num: 'Document No. / Code',
      doc_table_date: 'Issued Date',
      doc_table_title: 'Document Title',
    }
  }

  const t = (key: string): string => {
    return dictionary[currentLang.value]?.[key] || key
  }

  const setLang = (lang: string) => {
    currentLang.value = lang
    if (typeof window !== 'undefined') {
      localStorage.setItem('cdkt_lang', lang)
    }
  }

  const setFontSize = (size: string) => {
    fontSize.value = size
    if (typeof window !== 'undefined') {
      localStorage.setItem('cdkt_font_size', size)
      document.documentElement.className = `font-scale-${size}`
    }
  }

  const initSettings = () => {
    if (typeof window !== 'undefined') {
      const savedLang = localStorage.getItem('cdkt_lang')
      if (savedLang && ['VN', 'EN'].includes(savedLang)) {
        currentLang.value = savedLang
      }
      const savedSize = localStorage.getItem('cdkt_font_size')
      if (savedSize && ['small', 'normal', 'large'].includes(savedSize)) {
        fontSize.value = savedSize
        document.documentElement.className = `font-scale-${savedSize}`
      }
    }
  }

  return {
    currentLang,
    fontSize,
    t,
    setLang,
    setFontSize,
    initSettings
  }
}
