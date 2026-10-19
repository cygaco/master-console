"use strict";

const INJECTION_CLASSES = [
  {
    name: "system-prompt-injection",
    patterns: [
      /ignore\s+(all\s+)?(the\s+)?previous\s+instructions/i,
      /disregard\s+(all\s+)?(prior|previous|above|the\s+foregoing)/i,
      /your\s+(new\s+)?instructions\s+are\s+now/i,
      /forget\s+(all\s+)?(your\s+)?(prior|previous)\s+(instructions|directives)/i,
    ],
  },
  {
    name: "role-override",
    patterns: [
      /you\s+are\s+now\s+(a|an|the)\b/i,
      /your\s+new\s+role\s+is/i,
      /as\s+an?\s+AI[,]?\s+you\s+must/i,
      /from\s+now\s+on[,]?\s+you\s+(are|will|must|should)\b/i,
    ],
  },
  {
    name: "self-reference-override",
    patterns: [
      /(this|the\s+following)\s+(text\s+)?(overrides|supersedes|replaces)\s+your/i,
      /ignore\s+your\s+(system|developer|previous)\s+prompt/i,
    ],
  },
  {
    name: "privilege-escalation-framing",
    patterns: [
      /you\s+(now\s+)?have\s+(admin|root|full|elevated|unrestricted)\s+(access|privileges|permissions|mode)/i,
      /(enable|activate|enter|you\s+are\s+(now\s+)?in)\s+(jailbreak|dan|do\s+anything\s+now)\s*(mode)?/i,
      /jailbreak\s+(the\s+)?(model|assistant|ai|system|prompt)/i,
    ],
  },
];

const BUSINESS_VERBS = [
  /\b(install|publish|export|deploy|mirror|download|run|execute)\b/i,
];

module.exports = { INJECTION_CLASSES, BUSINESS_VERBS };
