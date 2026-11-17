import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const context = {exports: {}}; vm.runInNewContext(compiled, context); return context.exports;
}
for (const [name,path] of [["web","../features/student/profile/education-state.ts"],["mobile","../../mobile-app/services/api/educationState.ts"]]) {
 const api=load(path);
 const details={highest_qualification_id:"q",highest_qualification:"Qualification",course_id:"c",course:"Course",specialization_id:"s",specialization:"Specialty",current_city:"Pune"};
 test(`${name}: qualification cascade resets both descendants`,()=>{
   const next=api.chooseEducation(details,"highest_qualification",{id:"q2",name:"New"});
   assert.equal(next.highest_qualification_id,"q2"); assert.equal(next.course_id,null);assert.equal(next.specialization_id,null);assert.equal(next.course,"");assert.equal(next.current_city,"Pune");assert.equal(details.course_id,"c");
 });
 test(`${name}: course change keeps qualification and resets specialization`,()=>{
   const next=api.chooseEducation(details,"course",{id:"c2",name:"Second"});assert.equal(next.highest_qualification_id,"q");assert.equal(next.specialization_id,null);
 });
 test(`${name}: Others requires text and makes descendants free text`,()=>{
   const next=api.chooseEducation(details,"highest_qualification","other");assert.ok(api.educationErrors(next).highest_qualification);assert.equal(api.educationState(next,"course").freeText,true);assert.equal(api.educationState(next,"specialization").disabled,false);
   const answered=api.writeEducationText(next,"highest_qualification","A new qualification");assert.equal(api.educationErrors(answered).highest_qualification,undefined);assert.ok(api.educationErrors(answered).course);assert.ok(api.educationErrors(answered).specialization);
 });
 test(`${name}: parent gating and bounded plain text`,()=>{
   assert.equal(api.educationState({},"course").disabled,true);assert.equal(api.educationState({},"specialization").disabled,true);
   const next=api.writeEducationText(details,"course","<Course>\u0000"+"a".repeat(200));assert.equal(next.course.length,160);assert.ok(!/[<>\u0000]/.test(next.course));
 });
 test(`${name}: auto-select only a sole flagged N/A option`,()=>{
   const option={id:"na",name:"General / Not applicable",is_not_applicable:true};
   assert.equal(api.autoNAOption([option],{}).id,"na");assert.equal(api.autoNAOption([{...option,is_not_applicable:false}],{}),null);assert.equal(api.autoNAOption([option,{id:"s",name:"Science"}],{}),null);
 });
 test(`${name}: N/A never overwrites saved or custom answers`,()=>{
   const option={id:"na",name:"General / Not applicable",is_not_applicable:true};
   assert.equal(api.autoNAOption([option],details),null);assert.equal(api.autoNAOption([option],{education_others:{specialization:"Custom"},specialization:"Custom"}),null);
   assert.equal(api.autoNAOption([option],{specialization_id:"na",specialization:option.name}).id,"na");
 });
}
