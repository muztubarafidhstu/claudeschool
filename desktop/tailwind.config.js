/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', '"Noto Sans Bengali"', 'system-ui', 'sans-serif'], bn: ['"Noto Sans Bengali"', 'Inter', 'sans-serif'] },
      colors: {
        navy: '#0F172A',
        brand: { DEFAULT: '#0D9488', dark: '#0F766E', soft: '#CCFBF1' },
        ok: '#10B981', bad: '#EF4444', due: '#F59E0B',
        canvas: '#F8FAFC', line: '#E2E8F0',
      },
    },
  },
};
