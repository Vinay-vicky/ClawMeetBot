const fs = require("fs");
let c = fs.readFileSync("services/telegramService.js", "utf8");

// Lines 19-20: polling/webhook mode logs — use [^;]* to handle parens inside the string
c = c.replace(
  /if \(!isProduction\) console\.log\([^;]*polling mode[^;]*\);/,
  'if (!isProduction) logger.info("Bot running in polling mode (local dev)");'
);
c = c.replace(
  /else console\.log\([^;]*webhook mode[^;]*\);/,
  'else logger.info("Bot running in webhook mode (Render)");'
);

let remaining = (c.match(/console\.(log|error|warn)\(/g) || []).length;
console.log("Remaining console calls:", remaining);

fs.writeFileSync("services/telegramService.js", c, "utf8");
console.log("Done.");
