// Semantic colour tokens (`brand-700`, `ink-muted`, `line`…): one table shared with
// scripts/codemod-hex-tokens.ts, which rewrites exact `[#hex]` matches into these names.
// Values and rules live there and in tests/tailwind-color-tokens.test.ts.
const { COLOR_TOKENS } = require('./shared/color-tokens.ts')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{vue,ts,js}',
    './server/**/*.{ts,js}',
    // `shared/submission-status.ts` giữ lớp huy hiệu (`bg-[#fdf3e2] …`) chỉ dùng qua
    // `:class` — không quét `shared/` thì các lớp đó bị purge, huy hiệu mất màu.
    // tests/tailwind-content-shared.test.ts ghim dòng này.
    './shared/**/*.{ts,js}',
  ],
  // `useLayoutConfig` dựng `grid-cols-${n}` theo cấu hình trong DB — Tailwind
  // tĩnh quét không thấy chuỗi nguyên bản nên phải liệt kê for đúng các giá
  // trị hợp lệ (2|3|4). Đổi giới hạn ở validateLayoutConfig mà quên chỗ này thì
  // class sẽ bị purge và trang lọt về một cột.
  safelist: ['grid-cols-2', 'grid-cols-3', 'grid-cols-4'],
  theme: {
    extend: {
      // The old `admin-*` palette (0 uses) is folded in: darkest/dark/green/border/muted
      // are brand-950/brand-900/brand-700/line/ink-muted. `light` (#8ed694) is now
      // brand-300 and `bg` (#f4f7f4) is merged into surface.
      colors: { ...COLOR_TOKENS },
      // Custom animations belong here, not in a component's `<style scoped>`.
      // Vue rewrites scoped keyframe names (`blinkCursor` → `blinkCursor-a1b2c3`),
      // so an `animate-[blinkCursor_...]` utility referenced a name that existed
      // nowhere and silently rendered a motionless element. Declaring them in the
      // theme puts them in the global stylesheet, where the utility can find them.
      keyframes: {
        typingDot: {
          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.45' },
          '30%': { transform: 'translateY(-4px)', opacity: '1' },
        },
        fadeSlideUp: {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.95)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Marquee chạy ngang cho tiêu đề dài trên mobile (LiveTickerBar).
        // Text lặp 2 lần trong span; `-50%` đưa bản thứ hai vào đúng chỗ bản đầu,
        // tạo vòng lặp liền mạch không khoảng trống.
        ticker: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'typing-dot': 'typingDot 1.2s ease-in-out infinite',
        'fade-slide-up': 'fadeSlideUp 0.3s ease-out',
      },
    }
  },
  plugins: []
}
