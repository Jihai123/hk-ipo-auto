/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#F7F9FC',
        accent: {
          start: '#4f46e5',
          mid: '#6366f1',
          end: '#8b5cf6',
        },
        positive: '#10b981',
        negative: '#ef4444',
        neutral: '#f59e0b',
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0,0,0,0.04)',
        'card-hover': '0 8px 24px rgba(0,0,0,0.08)',
      },
      borderRadius: {
        'card': '14px',
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
