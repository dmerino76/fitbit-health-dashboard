/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'fitbit-teal': '#00B0B9',
                'fitbit-dark': '#101010',
                'fitbit-card': '#1E1E1E',
            }
        },
    },
    plugins: [],
}
