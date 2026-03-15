/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.tsx",
    "./src/**/*.{html,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        piano: {
          950: '#000000',
          900: '#050505',
          800: '#141414',
          700: '#1f1f1f'
        }
      },
      animation: {
        'fadeIn': 'fadeIn 0.3s ease-out'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        }
      }
    }
  },
  plugins: []
};
