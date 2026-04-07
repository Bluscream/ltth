module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'modules/**/*.js',
    'routes/**/*.js',
    '!**/node_modules/**'
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(nanoid)/)'
  ],
  transform: {
    '^.+\\.m?js$': 'babel-jest',
  },
};
