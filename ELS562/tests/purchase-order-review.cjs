const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exportsObj={};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'lib/purchase-order-review.ts'),'utf8')),{exports:exportsObj,require:()=>({extractPurchaseOrderFromNotes:JSON.parse,mergePurchaseOrderIntoNotes:(_,po)=>JSON.stringify(po)})});
const {advancePurchaseOrderReview,refreshOverduePurchaseOrders}=exportsObj;
const deliveredAt='2026-10-30T12:00:00.000Z',due='2026-11-01T12:00:00.000Z';
const base={status:'delivered',deliveredAt,approvalDueAt:due,updatedAt:deliveredAt,audit:[]};
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name);}
check('not approved one millisecond early',()=>assert.equal(advancePurchaseOrderReview(base,new Date(Date.parse(due)-1)),base));
const approved=advancePurchaseOrderReview(base,new Date(due));
check('approved exactly at 48 hours',()=>assert.equal(approved.status,'auto_approved'));
check('audit records automatic approval',()=>assert.equal(approved.audit[0].action,'auto_approved'));
check('repeated checks do not add duplicate approvals',()=>assert.equal(advancePurchaseOrderReview(approved,new Date(due)),approved));
for(const status of ['approved','changes_requested','delivery_failed','draft'])check('preserve '+status,()=>{const po={...base,status};assert.equal(advancePurchaseOrderReview(po,new Date('2026-11-02')),po);});
check('missing due date repaired from confirmed delivery',()=>{const po=advancePurchaseOrderReview({...base,approvalDueAt:null},new Date('2026-10-31'));assert.equal(po.approvalDueAt,due);});
check('invalid due date repaired without extending review',()=>assert.equal(advancePurchaseOrderReview({...base,approvalDueAt:'bad'},new Date('2026-11-02')).status,'auto_approved'));
check('unconfirmed email never approved from sent date alone',()=>{const po={...base,status:'sent_awaiting_delivery',deliveredAt:null,approvalDueAt:null,sentAt:'2026-01-01'};assert.equal(advancePurchaseOrderReview(po,new Date('2026-11-02')),po);});
check('first recorded secure-link opening recovers missed delivery',()=>{const po=advancePurchaseOrderReview({...base,status:'sent_awaiting_delivery',deliveredAt:null,approvalDueAt:null,audit:[{action:'contractor_opened',at:deliveredAt}]},new Date('2026-11-02'));assert.equal(po.status,'auto_approved');assert.equal(po.approvalDueAt,due);});
check('new provider confirmation starts 48 hours without backdating',()=>{const po=advancePurchaseOrderReview({...base,status:'sent_awaiting_delivery',deliveredAt:null,approvalDueAt:null},new Date(deliveredAt),true);assert.equal(po.status,'delivered');assert.equal(po.approvalDueAt,due);});
const route=fs.readFileSync(path.join(root,'app/api/text-automation/route.ts'),'utf8');
const ast=ts.createSourceFile('route.ts',route,ts.ScriptTarget.Latest,true);let fn;
ts.forEachChild(ast,n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='processPurchaseOrderAutomation')fn=n.getText(ast);});
async function cron(event){
 const initial={...base,status:'sent_awaiting_delivery',deliveredAt:null,approvalDueAt:null,resendEmailId:'email',lastDeliveryEvent:'sent'};
 let notes=JSON.stringify(initial),clock=Date.parse(deliveredAt);
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const admin={from(table){let patch;const q={select(){return q;},ilike(){return q;},limit(){return q;},in(){return q;},eq(){return q;},update(p){patch=p;return q;},then(resolve,reject){if(patch)notes=patch.notes;return Promise.resolve({data:table==='show_payroll'?[{id:'payroll',show_id:'show',crew_id:'crew',notes}]:[],error:null}).then(resolve,reject);}};return q;}};
 const context={admin,Date:Clock,advancePurchaseOrderReview,extractPurchaseOrderFromNotes:JSON.parse,mergePurchaseOrderIntoNotes:(_,po)=>JSON.stringify(po),resendDeliveryEvent:async()=>event,safeText:v=>String(v??'').trim(),sendPurchaseOrderReminderEmail:async()=>{throw new Error('Unexpected reminder');},purchaseOrderDisplayNumber:()=> 'PO'};
 const ctx=vm.createContext(context);vm.runInContext(transpile(fn),ctx);
 await vm.runInContext('processPurchaseOrderAutomation(admin,"https://example.com")',ctx);
 check(event+' starts delivery review even when delivered is no longer latest',()=>assert.equal(JSON.parse(notes).status,'delivered'));
 clock=Date.parse(due);await vm.runInContext('processPurchaseOrderAutomation(admin,"https://example.com")',ctx);
 check(event+' automatically approves on later cron run',()=>assert.equal(JSON.parse(notes).status,'auto_approved'));
}
(async()=>{
 await cron('delivered');await cron('opened');await cron('clicked');
 let saved=0;
 const admin={from(){let write=false;const q={select(){return q;},ilike(){return q;},order(){return q;},range(){return q;},eq(){return q;},update(p){write=true;assert.equal(JSON.parse(p.notes).status,'auto_approved');return q;},then(resolve,reject){if(write)saved++;return Promise.resolve({data:write?[{id:'row'}]:[{id:'row',notes:JSON.stringify(base)}],error:null}).then(resolve,reject);}};return q;}};
 await refreshOverduePurchaseOrders(admin);
 check('Payroll read catches up overdue review and persists it',()=>assert.equal(saved,1));
 console.log(passed+' purchase-order review checks passed; no live mail sent.');
})().catch(e=>{console.error(e);process.exitCode=1;});
