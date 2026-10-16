/** Tailwind is compiled ahead of time into public/css/app.css so the game runs with no internet. */
module.exports = {
  content: ['./public/**/*.html', './public/js/**/*.js'],
  theme: { extend: {} },
  plugins: [],
};
