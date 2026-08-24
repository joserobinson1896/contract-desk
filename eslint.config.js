// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    /**
     * Zod's standard idiom pairs a runtime schema with an inferred type of the
     * same name — `export const Charge = z.object({…})` alongside
     * `export type Charge = z.infer<typeof Charge>`. A value and a type sharing a
     * name occupy different declaration spaces, so this is legal TypeScript and
     * deliberate: callers write `Charge.parse(x)` and `const c: Charge` without
     * having to remember a `ChargeSchema` suffix.
     *
     * TypeScript still catches genuine redeclarations, so nothing is lost by
     * turning the lint rule off for the files that use the pattern.
     */
    files: ['src/domain/**/*.ts', 'src/fixtures/**/*.ts'],
    rules: {
      '@typescript-eslint/no-redeclare': 'off',
    },
  },
]);
