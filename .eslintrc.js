module.exports = {
  "env": {
    "es6": true,
    "node": true
  },
  "globals": {
    "atom": true,
    "document": false,
    "escape": false,
    "navigator": false,
    "unescape": false,
    "window": false,
    "PACKAGE_VERSION": false
  },
  "plugins": [
    "import"
  ],
  "extends": [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings"
  ],
  "parserOptions": {
    "sourceType": "module",
    "ecmaVersion": 13
  },
  "settings": {
    "import/resolver": {
      "webpack": {
        "config": {
          "resolve": {
            "extensions": [".js"]
          }
        }
      }
    }
  },
  "rules": {
    "curly": [
      "warn",
      "all"
    ],
    "linebreak-style": [
      "error",
      "unix"
    ],
    "no-console": [
      "error",
      {
        "allow": ["warn", "error", "info"]
      }
    ],
    "prefer-const": "error",
    "quotes": [
      "error",
      "single",
      "avoid-escape"
    ],
    "semi": [
      "error",
      "always"
    ],
    "sort-imports": [
      "warn",
      {
        "ignoreCase": false,
        "ignoreMemberSort": false,
        "memberSyntaxSortOrder": ["none", "all", "multiple", "single"]
      }
    ],
    "no-useless-escape": [
      "off"
    ],
    "no-empty": [
      "warn",
      {
        "allowEmptyCatch": true
      }
    ],
    "require-atomic-updates": [
      "off"
    ]
  },
};
