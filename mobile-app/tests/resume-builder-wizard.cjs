const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
function load(relative){const source=fs.readFileSync(path.join(__dirname,relative),'utf8');const context={exports:{},setTimeout,clearTimeout};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;}
const {ResumeDraftQueue}=load('../services/storage/resumeDraftQueue.ts');
const {stepErrors,finalErrors,rowErrors,sections,steps}=load('../screens/onboarding/resume-builder/model.ts');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
test('rapid edits debounce to one save of the latest draft',async()=>{
 const writes=[],states=[];const queue=new ResumeDraftQueue({name:'old'},true,async value=>writes.push(value.name),state=>states.push(state),5);
 queue.enqueue({name:'first'});queue.enqueue({name:'latest'});
 await new Promise(resolve=>setTimeout(resolve,20));await queue.flush();
 assert.deepEqual(writes,['latest']);assert.ok(states.includes('saving'));assert.equal(states.at(-1),'saved');
 await queue.flush();assert.equal(writes.length,1);queue.dispose();
});
test('concurrent flush calls serialize writes and skip stale intermediate edits',async()=>{
 const wait=deferred();const writes=[];let inFlight=0,maxInFlight=0;
 const queue=new ResumeDraftQueue({version:0},true,async value=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);writes.push(value.version);if(value.version===1)await wait.promise;inFlight--;},()=>{});
 queue.enqueue({version:1});const first=queue.flush();queue.enqueue({version:2});queue.enqueue({version:3});const second=queue.flush();
 assert.deepEqual(writes,[1]);wait.resolve();await Promise.all([first,second]);
 assert.deepEqual(writes,[1,3]);assert.equal(maxInFlight,1);assert.equal(queue.dirty,false);queue.dispose();
});
test('failed saves retain edits, never report success and can be retried',async()=>{
 let fail=true;const states=[];const queue=new ResumeDraftQueue({value:1},true,async()=>{if(fail)throw new Error('offline');},state=>states.push(state));
 queue.enqueue({value:2});await assert.rejects(()=>queue.flush());assert.equal(queue.dirty,true);assert.equal(states.at(-1),'error');assert.ok(!states.includes('saved'));
 fail=false;await queue.flush();assert.equal(queue.dirty,false);assert.equal(states.at(-1),'saved');queue.dispose();
});
test('leaving before the debounce flushes pending work and unchanged drafts do not save',async()=>{
 const writes=[];const queue=new ResumeDraftQueue({value:1},true,async value=>writes.push(value.value),()=>{});
 await queue.flush();assert.equal(writes.length,0);queue.enqueue({value:2});queue.dispose();await queue.flush();assert.deepEqual(writes,[2]);
});
test('a new unsaved profile draft is persisted before output even without edits',async()=>{
 let writes=0;const queue=new ResumeDraftQueue({value:1},false,async()=>writes++,()=>{});await queue.flush();assert.equal(writes,1);await queue.flush();assert.equal(writes,1);
});
test('the six steps require a name and allow empty optional sections',()=>{
 assert.deepEqual(Array.from(steps),['Personal Information','Experience','Education','Skills','Projects','More']);
 assert.ok(stepErrors(0,{}).length);for(let step=1;step<6;step++)assert.equal(stepErrors(step,{}).length,0);
 assert.ok(finalErrors({full_name:'Priya'}).length);assert.equal(finalErrors({full_name:'Priya',skills:['SQL']}).length,0);
});
test('entry validation checks required values, partial dates and ordering',()=>{
 assert.ok(rowErrors('experience',{}).company);assert.ok(rowErrors('projects',{name:'App'}).description);
 assert.ok(rowErrors('experience',{job_title:'Designer',company:'Studio',start_date:'2025-06',end_date:'2025-05'}).end_date);
 assert.ok(rowErrors('education',{qualification:'BSc',institution:'College',start_date:'2024-99',end_date:'2025'}).start_date);
 assert.equal(Object.keys(rowErrors('experience',{job_title:'Designer',company:'Studio',start_date:'2024',is_current:true,end_date:''})).length,0);
});
test('existing model fields remain editable, including imported resume metadata',()=>{
 for(const [section,keys] of Object.entries({experience:['employment_type','highlights','skills_used'],education:['location','description'],projects:['start_date','end_date','technologies','url'],certifications:['expiry_date','credential_id','url'],languages:['proficiency'],other_sections:['heading','items']}))
  for(const key of keys)assert.ok(sections[section].fields.some(field=>field.key===key),`${section}.${key}`);
});
