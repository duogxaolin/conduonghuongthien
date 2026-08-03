/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{vue,ts,js}',
    './server/**/*.{ts,js}',
  ],
  theme: {
    extend: {
      colors: {
        admin: {
          darkest: '#122815',
          dark:    '#1e4620',
          green:   '#2c6e33',
          light:   '#8ed694',
          bg:      '#f4f7f4',
          border:  '#e2ece3',
          muted:   '#667768',
        }
      },
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
      },
      animation: {
        'typing-dot': 'typingDot 1.2s ease-in-out infinite',
        'fade-slide-up': 'fadeSlideUp 0.3s ease-out',
      },
    }
  },
  plugins: []
}
