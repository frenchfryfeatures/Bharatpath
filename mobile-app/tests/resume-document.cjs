const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
function load(relative){const file=path.resolve(__dirname,relative);const source=fs.readFileSync(file,'utf8');const context={exports:{},require:name=>require(path.resolve(path.dirname(file),name))};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,context);return context.exports;}
const {normaliseResumeDocument,legacyResumeDocument}=load('../services/profile/resumeDocument.ts');
const {sections,contacts}=load('../screens/onboarding/resume-builder/model.ts');
const contract=require('../services/profile/resume-editor-contract.json');
const plain=value=>JSON.parse(JSON.stringify(value));
const full=()=>{
 const document=structuredClone(contract.document);
 for(const key of ['full_name','headline','location','summary'])document[key]=key;
 for(const key of Object.keys(document.contacts))if(key!=='others')document.contacts[key]=key+'@example.test';
 for(const [key,entry] of Object.entries(contract.entries)){
  const row=Object.fromEntries(Object.entries(entry).map(([name,value])=>[name,Array.isArray(value)?[name]:typeof value==='boolean'?true:name]));
  if(key==='others')document.contacts.others=[row];else document[key]=[row];
 }
 document.skills=['SQL'];document.achievements=['Award'];document.interests=['Chess'];return document;
};
test('all resume fields survive opening, editing one section and reopening',()=>{
 const document=full();const edited=normaliseResumeDocument(document);edited.summary='Updated summary';document.summary='Updated summary';
 assert.deepEqual(plain(normaliseResumeDocument(edited)),document);
 assert.deepEqual(plain(legacyResumeDocument({structured_resume:document})),document);
});
test('the builder and review controls cover every backend entry and contact field',()=>{
 for(const [key,entry] of Object.entries(contract.entries)){
  const section=key==='others'?'contact_links':key;
  assert.deepEqual(plain(sections[section].fields.map(field=>field.key).sort()),Object.keys(entry).sort());
 }
 assert.deepEqual(plain(contacts.map(field=>field.key).sort()),Object.keys(contract.document.contacts).filter(key=>key!=='others').sort());
});
test('old manual records migrate without leaking obsolete keys into strict API requests',()=>{
 const migrated=plain(legacyResumeDocument({full_name:'Priya',experience:[{employer:'Studio',title:'Designer',start_year:2020,end_year:2023,summary:'Design systems'}],education:[{qualification:'BSc',institution:'College',completed_year:2019}]}));
 assert.equal(migrated.experience[0].company,'Studio');assert.equal(migrated.experience[0].job_title,'Designer');assert.equal(migrated.experience[0].description,'Design systems');assert.equal(migrated.experience[0].end_date,'2023');
 assert.equal(migrated.education[0].end_date,'2019');assert.deepEqual(Object.keys(migrated.experience[0]).sort(),Object.keys(contract.entries.experience).sort());
});
test('unstructured legacy text is retained rather than silently dropped',()=>{
 const migrated=plain(legacyResumeDocument({raw_text:'Previously entered resume information'}));
 assert.deepEqual(migrated.other_sections,[{heading:'Imported resume text',items:['Previously entered resume information']}]);
});
