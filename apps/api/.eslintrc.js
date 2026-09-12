module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.json', sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  root: true,
  env: { node: true, jest: true },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.js'],
  overrides: [
    {
      files: ['migrations/**/*.js', 'scripts/**/*.js'],
      parserOptions: { project: null },
      rules: { '@typescript-eslint/no-floating-promises': 'off' }
    }
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'error',
    'no-restricted-syntax': [
      'error',
      { selector: 'Literal[value=/^-?\\d+\\.\\d+$/]', message: 'Float literals are forbidden for money; use integer minor units.' }
    ]
  }
};
