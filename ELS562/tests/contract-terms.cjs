const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app/api/onboarding/route.ts'),'utf8'),ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
const js=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const terms={};vm.runInNewContext(js(fs.readFileSync(path.join(root,'lib/contract-terms.ts'),'utf8')),{exports:terms});
const names=['buildSignedContractPdf','wrapPdfText','pdfEscape','initialsFromName'];const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)).map(node=>node.getText(ast)).join('\n');
let captured;
const context=vm.createContext({...terms,safeText:v=>String(v??'').trim(),ELS_COMPANY_REPRESENTATIVE:'Test Representative',ELS_COMPANY_SIGNATURE_JPEG_DATA_URL:'test-only',embeddedSignatureJpeg:()=>({width:1,height:1}),drawJpegCommand:()=>'',buildPdfWithJpegResources:pages=>{captured=pages;return 'mock-pdf';}});vm.runInContext(js(functions),context);
vm.runInContext('buildSignedContractPdf({contractor_name:"Test Contractor",effective_date:"2026-11-11",signature_data_url:"test-only",certifications:Array(10).fill(true)},"2026-11-11T12:00:00Z","Test Contractor")',context);
const signedText=captured.flatMap(page=>page.split('\n')).map(line=>line.match(/Td \((.*)\) Tj/)?.[1]?.replace(/\\([()\\])/g,'$1')||'').join(' ').replace(/\s+/g,' ');
let passed=0;function check(name,fn){fn();passed++;console.log('PASS '+name);}
check('signed agreement includes limited cancellation compensation and earned-hours protection',()=>{const text=signedText;for(const phrase of ['Compensation for Services Actually Rendered','Limited Cancellation Compensation','one (1) canceled workday only','shall not reduce','hours actually worked','entire job'])assert.ok(text.includes(phrase),phrase);assert.ok(!text.includes('at its sole discretion, approve cancellation pay'));});
check('signed PDF records payment-terms revision and matching certification count',()=>{assert.ok(captured.join(' ').includes(terms.CONTRACT_PAYMENT_TERMS_VERSION));assert.equal(terms.CONTRACT_CERTIFICATIONS.length,10);assert.ok(captured.join(' ').includes('[TC] Contractor acknowledges'));});
check('long certification acknowledgement wraps within document width',()=>{const lines=captured.flatMap(page=>page.split('\n')).filter(line=>line.includes('Tj ET'));assert.ok(lines.every(line=>{const match=line.match(/Td \((.*)\) Tj/);return !match||match[1].replace(/\\([()\\])/g,'$1').length<=104;}));});
(async()=>{
 const bytes=fs.readFileSync(path.join(root,'public/Emanuel_Labor_Services_Independent_Contractor_Agreement_Final.pdf'));
 const parsed=await require('pdf-parse/lib/pdf-parse.js')(new Uint8Array(bytes),{version:'v2.0.550'});const text=parsed.text.replace(/\s+/g,' ');
 check('unsigned downloadable PDF contains the same payment clauses as signing copy',()=>{for(const term of terms.CONTRACT_PAYMENT_TERMS)assert.ok(text.includes(term.text.replace(/\s+/g,' ')),term.heading||term.text.slice(0,40));});
 check('download retains all remaining agreement sections and unsigned signature lines',()=>{for(const label of ['1. Services to Be Performed','16. Entire Agreement & Severability','APPENDIX A','Contractor Signature:','Company Representative'])assert.ok(text.includes(label),label);assert.ok(!text.includes('Electronic Signature'));});
 const page=fs.readFileSync(path.join(root,'app/onboarding/[token]/page.tsx'),'utf8');
 check('onboarding view renders shared payment clauses and refreshes PDF URL version',()=>{assert.ok(page.includes('CONTRACT_PAYMENT_TERMS.map'));assert.ok(page.includes('?v=${CONTRACT_PAYMENT_TERMS_VERSION}'));assert.ok(!page.includes('at its sole discretion, approve cancellation pay'));});
 console.log(passed+' onboarding contract checks passed; existing signed records were not changed.');
})().catch(error=>{console.error(error);process.exitCode=1});
