const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(file, imports = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx:ts.JsxEmit.React, esModuleInterop:true},
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {exports, require: name => {
    assert.ok(name in imports, `Unexpected import ${name}`); return imports[name];
  }, console, Set});
  return exports;
}
const application = load('types/application.ts');
const {jobApplicationStatus} = load('utils/jobApplicationStatus.ts', {'@/types/application': application});
for (const stage of [...application.PIPELINE, ...application.TERMINAL_STAGES]) {
  for (const eligibility of ['ELIGIBLE', 'BELOW_THRESHOLD', 'SCORE_PENDING']) {
    const status = jobApplicationStatus(eligibility, stage, true, true);
    assert.equal(status.kind, 'application');
    assert.equal(status.label, stage === 'SUBMITTED' ? 'Applied' : application.stageLabel(stage));
    assert.notEqual(status.label, 'You can apply');
  }
}
assert.equal(jobApplicationStatus('ELIGIBLE', null, true).kind, 'unknown');
assert.equal(jobApplicationStatus('ELIGIBLE', null, false, true).kind, 'unknown');
assert.equal(jobApplicationStatus('ELIGIBLE', null).label, 'You can apply');
assert.equal(jobApplicationStatus('SCORE_PENDING', null).label, 'Bharatpath Score updating');
const {selectApplicationResume} = load('utils/applicationResume.ts');
const old = {resume_version_id:'old', confirmed:true, confirmed_at:'2026-10-01', created_at:'2026-09-01'};
const current = {resume_version_id:'current', confirmed:true, confirmed_at:'2026-11-19', created_at:'2026-08-01'};
const draft = {resume_version_id:'draft', confirmed:false, confirmed_at:null, created_at:'2026-12-01'};
assert.equal(selectApplicationResume([old, draft, current]).resume_version_id, 'current');
assert.equal(selectApplicationResume([draft]), undefined);
assert.equal(selectApplicationResume([]), undefined);

(async () => {
  const state = [], refs = []; let stateCursor = 0, refCursor = 0, focused;
  let requests = [];
  const rows = Array.from({length:101}, (_, i) => ({id:`a-${i}`,job_id:`job-${i}`,stage:'SUBMITTED',created_at:'2026-11-01'}));
  const React = {
    useState(initial) { const i=stateCursor++; if (!(i in state)) state[i]=initial; return [state[i], value=>state[i]=value]; },
    useRef(initial) { const i=refCursor++; return refs[i] ||= {current:initial}; },
    useCallback: fn=>fn,
  };
  const {useJobApplications} = load('hooks/useJobApplications.ts', {
    react:React, 'expo-router':{useFocusEffect: fn=>focused=fn},
    '@/services/api/applications':{listMyApplications:async ({cursor})=>{
      requests.push(cursor);
      return cursor ? {items:[rows[100], {...rows[0],id:'new-a',stage:'WITHDRAWN',created_at:'2026-11-19'}],next_cursor:null} : {items:rows.slice(0,100),next_cursor:'page-2'};
    }},
  });
  useJobApplications(); focused();
  await new Promise(resolve=>setImmediate(resolve));
  stateCursor=0; refCursor=0;
  const result=useJobApplications();
  assert.equal(result.loading,false); assert.equal(result.error,false);
  assert.equal(result.byJob['job-100'].id,'a-100', 'Older applications past page 100 must be found');
  assert.equal(result.byJob['job-0'].stage,'WITHDRAWN', 'Latest application wins');
  assert.equal(requests.length,2);

  // Render the real modal with a tiny hook host and invoke its actual handlers.
  // Opening/cancelling cannot submit; rapid double-taps submit only once.
  async function previewScenario(changeResume = false, noResume = false) {
    const cells=[]; let cursor=0,effects=[],first=true,versions=noResume?[]:[current],submissions=0,closes=0;
    const hookReact={
      createElement:(type,props,...children)=>({type,props:{...props,children}}),
      useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return [cells[i],v=>cells[i]=v]},
      useRef(initial){const i=cursor++;return cells[i] ||= {current:initial}},
      useCallback:fn=>fn,useEffect:fn=>{if(first)effects.push(fn)},
    };
    const native=Object.fromEntries(['ActivityIndicator','Image','Modal','Pressable','ScrollView','Text','View'].map(key=>[key,key]));
    native.StyleSheet={create:styles=>styles};native.useWindowDimensions=()=>({width:390});
    const {ApplyResumePreview}=load('components/jobs/ApplyResumePreview.tsx',{
      react:{__esModule:true,default:hookReact,...hookReact},'react-native':native,
      'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
      '@/components/layout/AppModal': {AppModal:'Modal'},
      'phosphor-react-native':{DownloadSimple:'Download',FileText:'File',X:'Close'},
      '@/utils/applicationResume':{selectApplicationResume},
      '@/components/resume-builder/ZoomableResumePages': {ZoomableResumePages:'ZoomableResumePages'},
      '@/services/api/resume':{listResumeVersions:async()=>versions,previewResumeVersion:async()=>({pages:['page'],truncated:false}),downloadResumeVersion:async()=>{}},
    });
    const props={visible:true,jobTitle:'Engineer',companyName:'Example',submitting:false,onClose:()=>closes++,onConfirm:async()=>submissions++,onEditResume:()=>{}};
    function render(){cursor=0;const tree=ApplyResumePreview(props);first=false;return tree}
    function text(node){return !node?'':typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):text(node.props?.children)}
    function find(node,predicate){if(!node)return;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result}}else if(typeof node==='object'){if(predicate(node))return node;return find(node.props?.children,predicate)}}
    render();effects.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));
    let tree=render();assert.equal(submissions,0,'Opening the preview must not apply');
    const close=find(tree,node=>node.props?.accessibilityLabel==='Close resume preview');close.props.onPress();assert.equal(closes,1);assert.equal(submissions,0);
    const confirm=find(tree,node=>node.type==='Pressable'&&text(node).includes('Confirm & apply'));
    if(noResume){assert.equal(confirm.props.disabled,true);return}
    assert.equal(confirm.props.disabled,false);
    if(changeResume)versions=[{...current,resume_version_id:'changed'}];
    confirm.props.onPress();confirm.props.onPress();await new Promise(resolve=>setImmediate(resolve));
    tree=render();
    if(changeResume){assert.equal(submissions,0);assert.ok(text(tree).includes('Your resume changed'))}
    else assert.equal(submissions,1,'Rapid double-taps must not submit twice');
  }
  await previewScenario();await previewScenario(true);await previewScenario(false,true);
  console.log('Job status, pagination and resume preview/confirmation tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
