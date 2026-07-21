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
      }
    }
  },
  plugins: []
}
