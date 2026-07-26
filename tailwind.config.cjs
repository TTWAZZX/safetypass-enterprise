/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  safelist: [
    'border-blue-200', 'hover:border-blue-200', 'bg-blue-50', 'text-blue-600',
    'group-hover:bg-blue-600', 'group-hover:text-white', 'text-blue-500',
    'bg-blue-500', 'bg-blue-600', 'hover:bg-blue-700', 'shadow-blue-200',
    'border-indigo-200', 'hover:border-indigo-200', 'bg-indigo-50', 'text-indigo-600',
    'group-hover:bg-indigo-600', 'text-indigo-500', 'bg-indigo-500',
    'bg-indigo-600', 'hover:bg-indigo-700', 'shadow-indigo-200',
  ],
  theme: {
    extend: {
      borderRadius: {
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
