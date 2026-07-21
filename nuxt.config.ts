export default defineNuxtConfig({
  compatibilityDate: '2026-07-20',
  devtools: { enabled: true },
  
  css: [
    '~/assets/css/main.css'
  ],

  runtimeConfig: {
    // Private server keys
    aiApiKey: process.env.AI_API_KEY || '',
    aiBaseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
    
    // Public keys
    public: {}
  },

  app: {
    head: {
      title: 'Con Đường Hướng Thiện - Cổng thông tin hỗ trợ hòa nhập cộng đồng và phát triển bền vững',
      htmlAttrs: {
        lang: 'vi'
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng, đào tạo nghề nghiệp, tư vấn tâm lý, kết nối doanh nghiệp và tuyên truyền pháp luật.' },
        { name: 'format-detection', content: 'telephone=no' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
        },
        {
          rel: 'stylesheet',
          href: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
        }
      ]
    }
  }
})
