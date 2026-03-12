/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#161b22',
        base: '#0f1117',
        border: '#30363d',
        muted: '#8b949e',
        subtle: '#484f58',
        accent: '#58a6ff',
        green: { 400: '#3fb950', 600: '#238636', 900: '#1a4731' },
        amber: { 400: '#d29922', 900: '#3d2f00' },
        red:   { 400: '#f85149', 900: '#3d1a1a' },
        purple: { 400: '#a371f7', 700: '#6e40c9' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

