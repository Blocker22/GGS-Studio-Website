/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#050708',
        panel: '#0a0d10',
        panel2: '#0d1114',
        cream: '#eef4f4',
        gold: '#d7ae5c',
        golddim: '#7a6431',
        teal: '#2fb8b0',
        line: 'rgba(238,244,244,0.12)',
      },
      fontFamily: {
        sans: ['Inter', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '3px',
      },
    },
  },
  plugins: [],
};
