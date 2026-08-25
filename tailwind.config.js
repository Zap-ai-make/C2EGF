/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  safelist: [
    // Navbar backgrounds
    'bg-blue-600',
    'bg-gray-600',
    'bg-gray-800',
    'bg-green-600',
    'bg-purple-600',
    // Table headers
    'bg-blue-100',
    'bg-gray-100',
    'bg-green-100',
    'bg-purple-100',
    // Borders
    'border-blue-300',
    'border-gray-300',
    'border-gray-700',
    'border-green-300',
    'border-purple-300',
    // Accents
    'bg-blue-50',
    'bg-gray-50',
    'bg-green-50',
    'bg-purple-50',
    // Text colors
    'text-gray-900',
    'text-gray-100'
  ]
}