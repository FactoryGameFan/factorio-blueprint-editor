import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.strict, // TODO: try strictTypeChecked (blocked on replacing `as any` data.json casts)
    {
        rules: {
            '@typescript-eslint/ban-ts-comment': 'off', // TODO: remove
            '@typescript-eslint/no-explicit-any': 'off', // TODO: remove
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ],
        },
    },
    {
        // Vite config runs in Node, so it needs Node globals.
        files: ['**/vite.config.js'],
        languageOptions: {
            globals: {
                process: 'readonly',
            },
        },
    },
    {
        // Scripts run in Node, so they need Node globals.
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly',
            },
        },
    },
    {
        ignores: [
            'packages/website/dist',
            'packages/editor/src/basis',
            'packages/exporter',
            'functions/corsproxy.js',
        ],
    }
)
