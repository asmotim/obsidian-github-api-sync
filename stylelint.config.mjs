/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    "selector-class-pattern":
      "^(github(?:-api)?-sync-[a-z0-9-]+(?:--[a-z0-9-]+)?)$",
    "keyframes-name-pattern": "^(github(?:-api)?-sync-[a-z0-9-]+)$",
  },
};
