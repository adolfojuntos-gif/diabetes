/**
 * Flat config, loading Next's configs directly.
 *
 * This used to wrap them in `FlatCompat` from `@eslint/eslintrc`, which is the shim for consuming
 * OLD eslintrc-style configs from a flat config file. `eslint-config-next` 16 already exports flat
 * config arrays, so the shim was translating something that needed no translation, and it crashed
 * while doing it: "Converting circular structure to JSON" from inside the config validator, before
 * a single file was read. So `npm run lint` did not lint, it threw, and had been doing so for long
 * enough that two separate sessions noted it as broken and worked around it.
 */
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Generated from the Drizzle schema by `npm run schema:build`. Editing it by hand is the bug.
      "src/lib/db/accountSchema.ts",
      "drizzle/**",
    ],
  },
  {
    /**
     * A leading underscore means "deliberately unused", which is the usual convention and the only
     * way to write a parameter a signature requires but the body ignores. `planForPrice(_priceId)`
     * is the case here: one paid tier means the price is not consulted yet, and the name documents
     * what the argument will be when a second tier arrives.
     */
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  {
    /**
     * Scripts and tests are Node programs, not part of the app bundle, so the rules written for
     * React components do not apply to them. They are still type-checked by `tsc`.
     */
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
