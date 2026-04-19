import js from "@eslint/js";
import tseslint from "typescript-eslint";
import tsdoc from "eslint-plugin-tsdoc";
import { defineConfig } from "eslint/config";

const restrictedRuntimeSyntax = [
  {
    selector: "MemberExpression[property.name='innerHTML']",
    message: "Do not write raw HTML into the DOM. Use Obsidian/DOM APIs that set text safely.",
  },
  {
    selector: "MemberExpression[property.name='outerHTML']",
    message: "Do not replace DOM with raw HTML in runtime code.",
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: "Do not inject unsanitized HTML into the DOM.",
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message: "Do not construct functions dynamically in runtime code.",
  },
];

export default defineConfig([
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "tests/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
      globals: {
        window: "readonly",
        requestUrl: "readonly",
        Buffer: "readonly",
        console: "readonly",
        crypto: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
      },
    },
    plugins: {
      tsdoc,
    },
    rules: {
      "no-throw-literal": "off",
      "no-eval": "error",
      "no-implied-eval": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "tsdoc/syntax": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-syntax": ["error", ...restrictedRuntimeSyntax],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/utils/runtime-log.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
]);
