const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObj = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'lib/cancellation-message.ts'), 'utf8')), { exports: exportsObj });
const { formatCancellationMessage, cancellationHeading, cancellationReply } = exportsObj;
const source = fs.readFileSync(path.join(root, 'app/api/text-automation/route.ts'), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['ensureSenderIdentity', 'safeText', 'buildCancellationNoticeBody', 'firstNameFrom']);
let parts = [], bodyExpression;
function walk(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) parts.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'queueRow' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    if (node.initializer.properties.some(p => p.name?.getText(ast) === 'message_type' && p.initializer?.getText(ast) === '"assignment_cancellation"')) bodyExpression = node.initializer.properties.find(p => p.name?.getText(ast) === 'body').initializer.getText(ast);
  }
  ts.forEachChild(node, walk);
}
walk(ast);
const ctx = vm.createContext({ formatCancellationMessage, cancellationDateTimeLabel: row => `${row.labor_date} · ${row.role}`, senderNameForMessage: () => 'Coordinator Name', auth: { user: {} } });
vm.runInContext(transpile(parts.join('\n')), ctx);
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
check('new default starts with starred heading and retains shift details', () => {
  const message = vm.runInContext('buildCancellationNoticeBody("Test Show", [{crew_name:"Test Crew",labor_date:"2026-11-02",role:"Stagehand"}])', ctx);
  assert.ok(message.startsWith(cancellationHeading)); assert.ok(message.includes('Test Show')); assert.ok(message.includes('2026-11-02 · Stagehand')); assert.ok(message.endsWith(cancellationReply));
});
check('legacy reply is replaced', () => { const message = formatCancellationMessage('Hi Crew,\nYour shift is canceled.\nPlease confirm this cancellation.'); assert.ok(!message.includes('Please confirm')); assert.ok(message.endsWith(cancellationReply)); });
check('formatting is idempotent with no repeated stars or reply', () => { const message = formatCancellationMessage('Custom shift cancellation'); assert.equal(formatCancellationMessage(message), message); });
check('edited cancellation receives heading and final reply after sender footer', () => {
  assert.ok(bodyExpression, 'Find actual queued cancellation body');
  ctx.bodyText = 'Custom cancellation\nPlease respond canceled to this cancellation.';
  const message = vm.runInContext(bodyExpression, ctx);
  assert.ok(message.startsWith(cancellationHeading)); assert.ok(message.includes('Custom cancellation')); assert.ok(message.includes('Coordinator: Coordinator Name')); assert.ok(message.endsWith(cancellationReply)); assert.equal(message.split(cancellationReply).length, 2);
});
console.log(passed + ' cancellation checks passed; no messages sent.');
