/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'cyber-bg': '#0a0e17',
        'cyber-panel': '#0f1521',
        'cyber-border': '#1a2332',
        'cyber-accent': '#00ffcc',
        'cyber-accent-dim': '#00aa88',
        'cyber-danger': '#ff3366',
        'cyber-warning': '#ffaa00',
        'cyber-text': '#c0c8d8',
        'cyber-text-dim': '#5a6478',
        'ocean-cold': '#2563eb',
        'ocean-cool': '#06b6d4',
        'ocean-mild': '#10b981',
        'ocean-warm': '#f59e0b',
        'ocean-hot': '#ef4444',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in': 'slide-in 0.3s ease-out',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.6', filter: 'brightness(1.5)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in': {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
