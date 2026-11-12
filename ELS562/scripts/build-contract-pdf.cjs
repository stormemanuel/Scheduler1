// Rebuild the unsigned onboarding download from the same payment clauses and
// remaining section text used by the signed-contract generator.
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function load(file){const exports={};vm.runInNewContext(transpile(fs.readFileSync(path.join(root,file),'utf8')),{exports,require,Blob,Uint8Array,atob,btoa});return exports;}
(async()=>{
 const terms=load('lib/contract-terms.ts'),pdf=load('lib/export-pdf-file.ts');
 const source=fs.readFileSync(path.join(root,'app/api/onboarding/route.ts'),'utf8'),ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
 const builder=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='buildSignedContractPdf');
 const sections=[{paragraphs:['This Independent Contractor Agreement ("Agreement") is made and entered into on ____________________, by and between Emanuel Labor Services LLC, a Louisiana limited liability company (the "Company"), and ____________________ (the "Contractor").']}];let current=sections[0];
 for(const statement of builder.body.statements){
  if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))continue;
  const call=statement.expression,name=call.expression.getText(ast),arg=call.arguments[0];
  if(name==='paragraph' && arg?.getText(ast)==='CONTRACT_CONDUCT_TERMS'){current.paragraphs.push(terms.CONTRACT_CONDUCT_TERMS);continue;}
  if(!arg||!ts.isStringLiteral(arg))continue;
  if(name==='heading'){
   if(arg.text.startsWith('APPENDIX A'))break;
   current={heading:arg.text,paragraphs:[]};sections.push(current);
   if(arg.text==='2. Payment')current.paragraphs=terms.CONTRACT_PAYMENT_TERMS.flatMap(term=>[...(term.heading?[term.heading+'.']:[]),term.text]);
  }else if(name==='paragraph')current.paragraphs.push(arg.text);
 }
 sections.push({heading:'APPENDIX A: CERTIFICATION OF INDEPENDENT CONTRACTOR STATUS',paragraphs:terms.CONTRACT_CERTIFICATIONS.map(cert=>'[   ] '+cert)});
 sections.push({paragraphs:['Contractor Signature: ______________________________  Date: ______________','Company Representative (Emanuel Labor Services LLC): ______________________________  Date: ______________']});
 const blob=await pdf.createExportPdf({title:'INDEPENDENT CONTRACTOR AGREEMENT',subtitle:'Payment terms revision: '+terms.CONTRACT_PAYMENT_TERMS_VERSION,showLogo:false,sections});
 fs.writeFileSync(path.join(root,'public/Emanuel_Labor_Services_Independent_Contractor_Agreement_Final.pdf'),Buffer.from(await blob.arrayBuffer()));
 console.log('Rebuilt unsigned onboarding agreement PDF.');
})().catch(error=>{console.error(error);process.exitCode=1});
