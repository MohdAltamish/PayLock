import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Invariant 9: money is Decimal, never a float. parseFloat on any value is
// banned in source; use Money/Decimal helpers from @paylock/schemas.
const noFloatMoney = [
  "error",
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message: "Money must use Decimal (see @paylock/schemas money helpers), not parseFloat.",
  },
  {
    selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
    message: "Money must use Decimal (see @paylock/schemas money helpers), not Number.parseFloat.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "**/test-results/**",
      "**/playwright-report/**",
      "AI-Toolkit/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-restricted-syntax": noFloatMoney,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
