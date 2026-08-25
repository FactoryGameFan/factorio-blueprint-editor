import { defineConfig } from 'vite-plus'

export default defineConfig({
    lint: {
        plugins: ['oxc', 'typescript', 'unicorn'],
        categories: {
            correctness: 'warn',
        },
        env: {
            builtin: true,
        },
        ignorePatterns: [
            'packages/website/dist',
            'packages/editor/src/basis',
            'packages/exporter',
            // Out of migration scope; its tsconfig references a gitignored,
            // wrangler-generated worker-configuration.d.ts that is absent on a
            // fresh checkout (e.g. CI), which oxlint reports as an invalid tsconfig.
            'packages/worker',
            'functions/corsproxy.js',
        ],
        rules: {
            'constructor-super': 'error',
            'for-direction': 'error',
            'getter-return': 'error',
            'no-async-promise-executor': 'error',
            'no-case-declarations': 'error',
            'no-class-assign': 'error',
            'no-compare-neg-zero': 'error',
            'no-cond-assign': 'error',
            'no-const-assign': 'error',
            'no-constant-binary-expression': 'error',
            'no-constant-condition': 'error',
            'no-control-regex': 'error',
            'no-debugger': 'error',
            'no-delete-var': 'error',
            'no-dupe-class-members': 'error',
            'no-dupe-else-if': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-empty': 'error',
            'no-empty-character-class': 'error',
            'no-empty-pattern': 'error',
            'no-empty-static-block': 'error',
            'no-ex-assign': 'error',
            'no-extra-boolean-cast': 'error',
            'no-fallthrough': 'error',
            'no-func-assign': 'error',
            'no-global-assign': 'error',
            'no-import-assign': 'error',
            'no-invalid-regexp': 'error',
            'no-irregular-whitespace': 'error',
            'no-loss-of-precision': 'error',
            'no-misleading-character-class': 'error',
            'no-new-native-nonconstructor': 'error',
            'no-nonoctal-decimal-escape': 'error',
            'no-obj-calls': 'error',
            'no-prototype-builtins': 'error',
            'no-redeclare': 'error',
            'no-regex-spaces': 'error',
            'no-self-assign': 'error',
            'no-setter-return': 'error',
            'no-shadow-restricted-names': 'error',
            'no-sparse-arrays': 'error',
            'no-this-before-super': 'error',
            'no-unassigned-vars': 'error',
            'no-undef': 'error',
            'no-unexpected-multiline': 'error',
            'no-unreachable': 'error',
            'no-unsafe-finally': 'error',
            'no-unsafe-negation': 'error',
            'no-unsafe-optional-chaining': 'error',
            'no-unused-labels': 'error',
            'no-unused-private-class-members': 'error',
            'no-unused-vars': 'error',
            'no-useless-assignment': 'error',
            'no-useless-backreference': 'error',
            'no-useless-catch': 'error',
            'no-useless-escape': 'error',
            'no-with': 'error',
            'preserve-caught-error': 'error',
            'require-yield': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',
            'no-array-constructor': 'error',
            'no-unused-expressions': 'error',
            'no-useless-constructor': 'error',
            'typescript/ban-ts-comment': 'off',
            'typescript/no-duplicate-enum-values': 'error',
            'typescript/no-dynamic-delete': 'error',
            'typescript/no-empty-object-type': 'error',
            'typescript/no-explicit-any': 'off',
            /*
                ignoreStatic, because four of this rule's reports are static
                methods passed as plain functions - EntitySprite.compareFn to
                Array#sort, and Entity/Tile.getItemName to getIconPairs. All
                three take everything they use as parameters and never touch
                `this`, so there is nothing to unbind. The rule's own option for
                exactly this, rather than a suppression.

                The instance-method reports it still makes are real and are
                fixed at the source: those handlers are arrow properties now, so
                they carry their own `this` and keep one stable identity per
                instance for `off()` to match on.
            */
            'typescript/unbound-method': ['warn', { ignoreStatic: true }],
            'typescript/no-extra-non-null-assertion': 'error',
            'typescript/no-extraneous-class': 'error',
            'typescript/no-invalid-void-type': 'error',
            'typescript/no-misused-new': 'error',
            'typescript/no-namespace': 'error',
            'typescript/no-non-null-asserted-nullish-coalescing': 'error',
            'typescript/no-non-null-asserted-optional-chain': 'error',
            'typescript/no-non-null-assertion': 'error',
            'typescript/no-require-imports': 'error',
            'typescript/no-this-alias': 'error',
            'typescript/no-unnecessary-type-constraint': 'error',
            'typescript/no-unsafe-declaration-merging': 'error',
            'typescript/no-unsafe-function-type': 'error',
            'typescript/no-wrapper-object-types': 'error',
            'typescript/prefer-as-const': 'error',
            'typescript/prefer-literal-enum-member': 'error',
            'typescript/prefer-namespace-keyword': 'error',
            'typescript/triple-slash-reference': 'error',
            'typescript/unified-signatures': 'error',
            'vite-plus/prefer-vite-plus-imports': 'error',
        },
        overrides: [
            {
                files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
                rules: {
                    'constructor-super': 'off',
                    'getter-return': 'off',
                    'no-class-assign': 'off',
                    'no-const-assign': 'off',
                    'no-dupe-class-members': 'off',
                    'no-dupe-keys': 'off',
                    'no-func-assign': 'off',
                    'no-import-assign': 'off',
                    'no-new-native-nonconstructor': 'off',
                    'no-obj-calls': 'off',
                    'no-redeclare': 'off',
                    'no-setter-return': 'off',
                    'no-this-before-super': 'off',
                    'no-undef': 'off',
                    'no-unreachable': 'off',
                    'no-unsafe-negation': 'off',
                    'no-var': 'error',
                    'no-with': 'off',
                    'prefer-const': 'error',
                    'prefer-rest-params': 'error',
                    'prefer-spread': 'error',
                },
            },
            {
                files: ['**/vite.config.js'],
                globals: {
                    process: 'readonly',
                },
            },
            {
                // tools/ joins scripts/ here: the oracle probes are Node
                // scripts run by hand against a local Factorio, not part of any
                // build or test, and they reach for the same globals.
                files: ['scripts/**/*.mjs', 'tools/**/*.mjs'],
                globals: {
                    console: 'readonly',
                    process: 'readonly',
                    // zlib round trips through Buffer, which the oracle probes
                    // use to build blueprint strings.
                    Buffer: 'readonly',
                    // Node's timer family. Declared as a group rather than
                    // one at a time so the next script reaching for the other
                    // half of a pair does not fail lint for it.
                    setTimeout: 'readonly',
                    clearTimeout: 'readonly',
                    setInterval: 'readonly',
                    clearInterval: 'readonly',
                },
            },
        ],
        options: {
            typeAware: true,
            typeCheck: true,
        },
        jsPlugins: [
            {
                name: 'vite-plus',
                specifier: 'vite-plus/oxlint-plugin',
            },
        ],
    },
    fmt: {
        printWidth: 100,
        tabWidth: 4,
        semi: false,
        singleQuote: true,
        trailingComma: 'es5',
        arrowParens: 'avoid',
        sortPackageJson: false,
        ignorePatterns: [
            'packages/editor/src/basis',
            'packages/exporter',
            '**/package-lock.json',
            'packages/worker/worker-configuration.d.ts',
            '.claude',
            '.superpowers',
            '**/*.yml',
            '**/*.yaml',
            // Oracle fixtures are machine output, and the two writers disagree
            // on their canonical form: a generator emits JSON.stringify's
            // 4-space expansion while oxfmt collapses short arrays onto one
            // line, so whichever ran last wins and the other reports a
            // failure. The generator owns these files - "never hand-edit a
            // fixture to make something pass" applies to a formatter as much
            // as to a person, since a reformat is a diff no probe produced.
            'tools/oracle/fixtures',
        ],
    },
    test: {
        projects: [
            // editor unit tests: uses packages/editor/vitest.config.ts as-is
            './packages/editor',
            {
                // type-check-gate tests (outside any workspace package)
                test: {
                    name: 'gate',
                    environment: 'node',
                    include: ['scripts/**/*.test.mjs'],
                    exclude: ['tests/**', '**/node_modules/**', '**/dist/**'],
                },
            },
            {
                /*
                    The tests under tests/ that need no browser. Two reasons they
                    are here rather than in a package's own project.

                    A check that needs no browser should not be behind one. Both
                    runners gate a PR now that the Playwright suite runs in CI
                    too, but they do not cost the same: `vp test` is seconds
                    inside `checks`, where the browser suite is a separate
                    ~5-minute job that first has to bring up two dev servers. The
                    corpus guard in tests/helpers/blueprint-files.test.ts (#190)
                    is pure Node, so it belongs in the cheap one - and it stays
                    green even on a day the browser job is broken for reasons of
                    its own.

                    And the root tsconfig is the only one here that puts `node`
                    in `types`; packages/editor narrows it back to typed-factorio
                    so browser code cannot reach node globals. A test that reads
                    a file off disk therefore has to sit under a directory the
                    root config owns, whatever package it is testing.

                    Only *.test.ts is collected. The 40 specs next door are
                    Playwright's and would fail immediately under vitest, having
                    no browser fixtures; playwright.config.ts pins the mirror
                    image of this so neither runner collects the other's files.
                */
                test: {
                    name: 'unit',
                    environment: 'node',
                    include: ['tests/**/*.test.ts'],
                },
            },
        ],
    },
})
