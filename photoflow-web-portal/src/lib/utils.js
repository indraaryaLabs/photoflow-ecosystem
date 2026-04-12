/**
 * Utility: className merger — menggabungkan class names dan membuang nilai falsy.
 * @param {...string} classes
 * @returns {string}
 */
export const cn = (...classes) => classes.filter(Boolean).join(' ');

/**
 * Swipe confidence threshold untuk framer-motion drag gestures.
 */
export const swipeConfidenceThreshold = 10000;

/**
 * Menghitung kekuatan swipe berdasarkan offset dan velocity.
 * @param {number} offset
 * @param {number} velocity
 * @returns {number}
 */
export const swipePower = (offset, velocity) => Math.abs(offset) * velocity;
