import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: { colors: { slate: { 950: '#020617' }, teal: { 600: '#0D9488', 700: '#0F766E' } } } },
} satisfies Config;
