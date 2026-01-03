module.exports = {
  getWhiteSpace(indentation) {
    try {
      return new Array((indentation * 2) - 1).join(' ');
    } catch(error) { return ''; }
  }
};
