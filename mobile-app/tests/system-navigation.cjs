const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
function load(file, imports = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const exports = {};
  vm.runInNewContext(source, {exports, React:imports.react?.default||imports.react, require:name=>{assert.ok(name in imports, `Unexpected import ${name}`);return imports[name]},console,Number,Math});
  return exports;
}
const geometry = load('utils/systemNavigation.ts');
for (const bottom of [0, 16, 24, 34, 48]) {
  const result = geometry.systemNavigationLayout(844, bottom);
  assert.equal(result.bottom, bottom);
  assert.equal(result.contentHeight + result.bottom, 844);
  assert.equal(result.backgroundColor, '#FFFFFF');
  assert.equal(result.buttonStyle, 'dark');
}
assert.equal(geometry.systemNavigationLayout(844, 34, 'dark').backgroundColor, '#000000');
assert.equal(geometry.systemNavigationLayout(844, 34, 'dark').buttonStyle, 'light');
assert.equal(geometry.systemNavigationLayout(844, -10).bottom, 0);
assert.equal(geometry.systemNavigationLayout(844, NaN).bottom, 0);
assert.equal(geometry.systemNavigationLayout(20, 48).contentHeight, 0);

const metrics={insets:{top:47,bottom:34,left:0,right:0},frame:{x:0,y:0,width:390,height:844}};
let effects=[],appState,visibility;const calls=[];
const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),createContext:()=>({Provider:'WindowMetrics'}),useContext:()=>metrics,useMemo:fn=>fn(),useEffect:fn=>effects.push(fn)};
const safe={useSafeAreaInsets:()=>metrics.insets,useSafeAreaFrame:()=>metrics.frame,SafeAreaFrameContext:{Provider:'Frame'},SafeAreaInsetsContext:{Provider:'Insets'},SafeAreaProvider:'SafeAreaProvider'};
const native={Platform:{OS:'android'},View:'View',Modal:'Modal',StyleSheet:{create:styles=>styles},AppState:{addEventListener:(_,fn)=>{appState=fn;return {remove:()=>calls.push('remove-app-state')}}}};
const nav={setButtonStyleAsync:async style=>calls.push(['buttons',style]),setVisibilityAsync:async state=>calls.push(['visibility',state]),addVisibilityListener:fn=>{visibility=fn;return {remove:()=>calls.push('remove-visibility')}}};
const {SystemNavigationFrame}=load('components/layout/SystemNavigationFrame.tsx',{
  react:{__esModule:true,default:React,...React},'react-native':native,'react-native-safe-area-context':safe,
  'expo-navigation-bar':nav,'expo-system-ui':{setBackgroundColorAsync:async color=>calls.push(['background',color])},
  '@/utils/systemNavigation':geometry,'@/utils/logger':{logger:{warn:()=>{}}},
});
function find(node,test){if(!node)return;if(Array.isArray(node)){for(const child of node){const result=find(child,test);if(result)return result}}else if(typeof node==='object'){if(test(node))return node;return find(node.props?.children,test)}}
const tree=SystemNavigationFrame({children:'content',manageNativeBar:true,transparent:true});
assert.equal(find(tree,node=>node.props?.testID==='system-navigation-area').props.style.height,34);
assert.equal(find(tree,node=>node.props?.testID==='system-navigation-area').props.style.backgroundColor,'#FFFFFF');
assert.equal(find(tree,node=>node.type==='Insets').props.value.bottom,0,'Bottom inset must be consumed exactly once');
assert.equal(find(tree,node=>node.type==='Insets').props.value.top,47);
assert.equal(find(tree,node=>node.type==='Frame').props.value.height,810);
assert.equal(find(tree,node=>node.props?.collapsable===false).props.style.overflow,'hidden','Scrolling and absolute overlays must be clipped above system navigation');
assert.equal(tree.props.children[0].props.style[1].backgroundColor,'transparent','Transparent modal backdrops must still reveal the underlying page');
const cleanup=effects.pop()();
assert.ok(calls.some(([kind,value])=>kind==='buttons'&&value==='dark'));
assert.ok(calls.some(([kind,value])=>kind==='visibility'&&value==='visible'));
const before=calls.length;appState('active');visibility({visibility:'hidden'});assert.ok(calls.length>before);
cleanup();assert.ok(calls.includes('remove-app-state')&&calls.includes('remove-visibility'));

const {AppModal}=load('components/layout/AppModal.tsx',{
  react:{__esModule:true,default:React,...React},'react-native':native,'react-native-safe-area-context':safe,
  './SystemNavigationFrame':{SystemNavigationFrame:'ProtectedFrame',useSystemWindowMetrics:()=>metrics},
  '@/components/feedback/AppToast':{AppToastRoot:'AppToastRoot'},
});
const modal=AppModal({visible:true,transparent:true,children:'dialog'});
assert.equal(modal.props.navigationBarTranslucent,true);assert.equal(modal.props.statusBarTranslucent,true);
assert.equal(find(modal,node=>node.type==='SafeAreaProvider').props.initialMetrics.insets.bottom,34,'Native windows must receive the original inset, not the root-consumed zero');
assert.equal(find(modal,node=>node.type==='ProtectedFrame').props.transparent,true);

// Prevent future sheets, dropdowns or dialogs from bypassing protection.
let protectedWindows=0;
function audit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){audit(file);continue}if(!file.endsWith('.tsx')||file.endsWith('AppModal.tsx'))continue;const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),99,true);const nativeNames=new Set();for(const item of source.statements)if(ts.isImportDeclaration(item)&&item.moduleSpecifier.text==='react-native')for(const named of item.importClause?.namedBindings?.elements||[])if((named.propertyName||named.name).text==='Modal')nativeNames.add(named.name.text);function walk(node){if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){assert.ok(!nativeNames.has(node.tagName.getText(source)),`Unprotected native modal: ${file}`);if(node.tagName.getText(source)==='Modal')protectedWindows++}ts.forEachChild(node,walk)}walk(source)}}
['app','screens','components'].forEach(dir=>audit(path.join(root,dir)));

(async()=>{
  let unread=false,focus,route;
  const hooks={...React,useState:()=>[unread,value=>unread=value],useCallback:fn=>fn};
  const {NotificationButton}=load('components/navigation/NotificationButton.tsx',{
    react:{__esModule:true,default:hooks,...hooks},'react-native':{Pressable:'Pressable',View:'View',StyleSheet:native.StyleSheet},
    'expo-router':{useRouter:()=>({push:value=>route=value}),useFocusEffect:fn=>focus=fn},
    'phosphor-react-native':{Bell:'Bell'},'@/services/api/notifications':{getInbox:async()=>({unread:3}),getUnreadCount:async()=>3,cachedUnreadCount:()=>null},
  });
  NotificationButton();focus();await new Promise(resolve=>setImmediate(resolve));
  const bell=NotificationButton();assert.equal(bell.props.accessibilityLabel,'Notifications, unread updates');
  bell.props.onPress();assert.equal(route,'/notifications');
  const tabState=[];let tabCursor=0;const keyboardHandlers={};effects=[];
  const tabReact={...React,useState(initial){const i=tabCursor++;if(!(i in tabState))tabState[i]=typeof initial==='function'?initial():initial;return [tabState[i],value=>tabState[i]=value]}};
  const {BottomTabBar}=load('components/navigation/BottomTabBar.tsx',{
    react:{__esModule:true,default:tabReact,...tabReact},
    'react-native':{...native,Text:'Text',Pressable:'Pressable',Keyboard:{addListener:(name,fn)=>{keyboardHandlers[name]=fn;return {remove:()=>{}}}}},
    'expo-blur':{BlurView:'BlurView'},'phosphor-react-native':Object.fromEntries(['House','Briefcase','ListChecks','User','Sparkle'].map(name=>[name,name])),
    '@/theme/tokens':{Colors:{navy:'#0A1931',text:{muted:'#5F6B80'}},Layout:{maxContentWidth:430},Shadows:{bottomNav:{}}},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({...metrics.insets,bottom:0})},
    '@/components/assistant/CareerAssistantModal':{CareerAssistantModal:'Assistant'},
  });
  function renderTab(){tabCursor=0;return BottomTabBar({activeTab:'board',onTabPress:()=>{}})}
  let tabs=renderTab();effects.forEach(fn=>fn());
  assert.ok(find(tabs,node=>node.props?.pointerEvents==='box-none'));
  keyboardHandlers.keyboardDidShow();tabs=renderTab();assert.equal(find(tabs,node=>node.props?.pointerEvents==='box-none'),undefined,'Keyboard must not lift a floating tab bar over the form');
  keyboardHandlers.keyboardDidHide();tabs=renderTab();assert.ok(find(tabs,node=>node.props?.pointerEvents==='box-none'));
  console.log(`System-area geometry, native visibility, modal protection (${protectedWindows} windows), and notification routing passed.`);
})().catch(error=>{console.error(error);process.exitCode=1});
