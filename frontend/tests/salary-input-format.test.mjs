import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path) {
 const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
 const context={exports:{},Intl};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return context.exports;
}
for(const [platform,path,parserPath,parserName] of [
 ['web','../features/student/salary-input.ts','../features/student/salary.ts','parseSalaryLpa'],
 ['mobile','../../mobile-app/utils/salaryInput.ts','../../mobile-app/screens/onboarding/conversationValidation.ts','parseSalaryInput']
]) {
 const {formatSalaryInput:format,salaryCaretPosition:caret}=load(path);
 const parse=load(parserPath)[parserName];
 test(`${platform}: Indian and US comma grouping`,()=>{
  for(const [raw,inr,usd] of [['1000','1,000','1,000'],['100000','1,00,000','100,000'],['1234567','12,34,567','1,234,567'],['1000000000','1,00,00,00,000','1,000,000,000']]) {
   assert.equal(format(raw,'INR'),inr);assert.equal(format(raw,'USD'),usd);
  }
 });
 test(`${platform}: incremental typing, deletion, zero and empty values`,()=>{
  let typed='';for(const digit of '1234567') typed=format(typed+digit,'INR');
  assert.equal(typed,'12,34,567');assert.equal(format(typed.slice(0,-1),'INR'),'1,23,456');
  assert.equal(format('', 'USD'),'');assert.equal(format(null),'');assert.equal(format(0),'0');
 });
 test(`${platform}: changing currency and pasted separators`,()=>{
  assert.equal(format('12,34,567','USD'),'1,234,567');
  assert.equal(format('1,234,567','INR'),'12,34,567');
  assert.equal(format('1,23,456.50','USD'),'123,456.50');
  assert.equal(format('12 LPA','INR'),'12 LPA');
 });
 test(`${platform}: grouped amounts parse to unchanged numeric API values`,()=>{
  for(const currency of ['INR','USD']) for(const number of [0,1234,1234567,1000000000]) {
   assert.equal(parse(format(number,currency),currency).value,number);
  }
 });
 test(`${platform}: caret follows the digits rather than added commas`,()=>{
  assert.equal(caret('1234','1,234',4),5);
  assert.equal(caret('1234','1,234',2),3);
  assert.equal(caret('12345','12,345',2),2);
  assert.equal(caret('','',0),0);
 });
}
