// Optional integration suite: install @electric-sql/pglite@0.3.14 in a separate
// test prefix, then set PGLITE_MODULE to that package's absolute path.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const db=new PGlite();let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
const coordinator='11111111-1111-4111-8111-111111111111',creator='22222222-2222-4222-8222-222222222222';
const show1='33333333-3333-4333-8333-333333333333',show2='44444444-4444-4444-8444-444444444444',show3='55555555-5555-4555-8555-555555555555';
const document=(ids,token)=>({kind:'coordinator',coordinatorUserId:coordinator,token,status:'ready',showLines:ids.map(showId=>({showId,amount:100})),total:100*ids.length});
async function create(ids,token='a'.repeat(43),doc=document(ids,token)){
 return db.query('select * from public.create_coordinator_purchase_order($1::uuid,$2::text,$3::jsonb,$4::uuid,$5::uuid[])',[coordinator,token,JSON.stringify(doc),creator,'{'+ids.join(',')+'}']);
}
(async()=>{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table public.shows(id uuid primary key);');
 await db.query('insert into public.shows values ($1),($2),($3)',[show1,show2,show3]);
 const migration=fs.readFileSync(path.join(__dirname,'../supabase/coordinator_purchase_orders.sql'),'utf8');
 await check('migration executes on PostgreSQL',()=>db.exec(migration));
 await check('migration is repeatable',()=>db.exec(migration));
 await db.exec('set role service_role');
 let first;
 await check('service role creates one order and claims every selected show',async()=>{first=(await create([show1,show2])).rows[0];assert.ok(first.id);const rows=await db.query('select count(*)::int as count from public.coordinator_purchase_order_shows');assert.equal(rows.rows[0].count,2);});
 await check('overlapping order fails and rolls back entire new document',async()=>{await assert.rejects(()=>create([show2,show3],'b'.repeat(43)),error=>error.code==='23505');const rows=await db.query('select count(*)::int as count from public.coordinator_purchase_orders');assert.equal(rows.rows[0].count,1);const claims=await db.query('select count(*)::int as count from public.coordinator_purchase_order_shows where show_id=$1',[show3]);assert.equal(claims.rows[0].count,0);});
 await check('incorrect total rejected',()=>assert.rejects(()=>create([show3],'c'.repeat(43),{...document([show3],'c'.repeat(43)),total:999})));
 await check('duplicate show IDs rejected',()=>assert.rejects(()=>create([show3,show3],'d'.repeat(43))));
 await check('document cannot claim another coordinator identity',()=>assert.rejects(()=>create([show3],'e'.repeat(43),{...document([show3],'e'.repeat(43)),coordinatorUserId:creator})));
 await check('missing document kind rejected',async()=>{const doc=document([show3],'f'.repeat(43));delete doc.kind;await assert.rejects(()=>create([show3],'f'.repeat(43),doc));});
 await check('discard cascade releases show claims',async()=>{await db.query('delete from public.coordinator_purchase_orders where id=$1',[first.id]);assert.equal((await db.query('select count(*)::int as count from public.coordinator_purchase_order_shows')).rows[0].count,0);await create([show1],'g'.repeat(43));});
 await check('different coordinators can invoice their separate balances on the same show',async()=>{const token='i'.repeat(43),doc={...document([show1],token),coordinatorUserId:creator};const result=await db.query('select * from public.create_coordinator_purchase_order($1::uuid,$2::text,$3::jsonb,$4::uuid,$5::uuid[])',[creator,token,JSON.stringify(doc),creator,'{'+show1+'}']);assert.ok(result.rows[0].id);});
 await db.exec('reset role;set role authenticated');
 await check('authenticated browser role cannot read private coordinator orders',()=>assert.rejects(()=>db.query('select * from public.coordinator_purchase_orders'),error=>error.code==='42501'));
 await check('authenticated browser role cannot call create RPC',()=>assert.rejects(()=>create([show3],'h'.repeat(43)),error=>error.code==='42501'));
 await db.exec('reset role;set role anon');
 await check('anonymous database role cannot read approval documents',()=>assert.rejects(()=>db.query('select * from public.coordinator_purchase_orders'),error=>error.code==='42501'));
 console.log(passed+' PostgreSQL migration and transaction checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.close());
