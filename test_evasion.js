const { classifyCommand } = require('./src/utils/commandSandbox.ts');

// Can't actually import TS directly from Node, so let me just trace through the logic
const cfg = {
  enabled: true,
  allowPrefixes: ['git status', 'git diff', 'npm test', 'ls', 'cat'],
  denyPatterns: ['rm -rf', 'sudo ', 'curl ']
};

function simulate(cmd) {
  // Simulating classifyCommand logic
  const raw = String(cmd ?? '').trim();
  const lower = raw.toLowerCase();
  const deny = (cfg.denyPatterns || []).map(s => s.toLowerCase().trim()).filter(Boolean);
  
  // Check deny
  if (deny.some(p => lower.includes(p))) {
    return 'DENY';
  }
  
  // Check allow via split
  const parts = String(raw ?? '')
    .split(/\n|&&|\|\||[|;&]/)
    .map(s => s.trim())
    .filter(Boolean);
  
  if (!parts.length) return 'ASK';
  
  const allow = (cfg.allowPrefixes || []).map(s => s.toLowerCase().trim()).filter(Boolean);
  if (!allow.length) return 'ASK';
  
  const allAllowed = parts.every(part => {
    const p = part.toLowerCase();
    return allow.some(pre => p === pre || p.startsWith(pre + ' ') || p.startsWith(pre));
  });
  
  return allAllowed ? 'ALLOW' : 'ASK';
}

// Test various evasion patterns
const tests = [
  'rm -rf /',                           // Should DENY
  'rm  -rf /',                          // Extra space - bypass?
  'rm\t-rf /',                         // Tab escape
  'rm\ -rf /',                         // Escaped space
  'rm -rf $(pwd)',                      // Command substitution
  'rm -rf `pwd`',                       // Backtick substitution
  'rm -rf ~/important',                 // Home expansion
  'rm -rf -- /',                        // Double dash before
  'RM -RF /',                           // Case (should already be caught)
  'curl http://bad.com',                // Should DENY
  'curl  http://bad.com',               // Extra space
  '$(rm -rf /)',                        // Wrapped in subshell
  'eval "rm -rf /"',                    // Eval wrapper
  'sh -c "rm -rf /"',                   // sh wrapper
  'rm -rf /; echo done',                // Semicolon after pattern
  '; rm -rf /',                         // Semicolon before
  'git status && rm -rf /',             // rm-rf in second part
];

console.log('Testing evasion patterns:\n');
tests.forEach(t => {
  const result = simulate(t);
  console.log(`${result.padEnd(5)} | ${t}`);
});
