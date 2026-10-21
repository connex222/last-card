/** Compiled local fonts and accessible lounge theme; runs without a CDN. */
module.exports = {
  content: ['./public/**/*.html', './public/js/**/*.js'],
  theme: { extend: {
    fontFamily: { sans: ['Manrope', 'system-ui', 'sans-serif'], display: ['Bodoni Moda', 'Georgia', 'serif'] },
    colors: { lounge: { ink: '#10171c', panel: '#1a2831', elevated: '#253641', emerald: '#21b58b', gold: '#e9c879', cream: '#f8f4e9', mist: '#c1d0d4' } },
    backdropBlur: { lounge: '18px' },
  } },
  plugins: [],
};
