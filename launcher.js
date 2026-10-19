const $ = (id) => document.getElementById(id);
const nativeFetch = window.fetch.bind(window);
const CACHE = 'alpine-pop-parts-v1';
let selectedMap = 'megapark';
let engine = null;
let started = false;
let downloading = false;
let manifest;
const labels = {megapark:'Five park lines. Progression kickers to massive air. Rails to make your own.',peakside:'A whole mountain bowl. Park laps, powder turns, tree runs and the superpipe.'};
try { selectedMap = localStorage.getItem('alpine-pop-map') === 'peakside' ? 'peakside' : 'megapark'; } catch {}
function chooseMap(map) {
  if (downloading) return;
  selectedMap = map;
  document.querySelectorAll('[data-map]').forEach((b) => { b.classList.toggle('selected',b.dataset.map === map); b.setAttribute('aria-pressed',String(b.dataset.map === map)); });
  $('key-art').src = `${map}.png`;
  $('key-art').alt = map === 'megapark' ? 'Alpine Pop: a skier grabs red skis above the snowy terrain park.' : 'Alpine Pop: a skier carves through a huge fan of powder above Peakside resort.';
  $('map-description').textContent = labels[map];
  try { localStorage.setItem('alpine-pop-map',map); } catch {}
}
document.querySelectorAll('[data-map]').forEach((b)=>b.addEventListener('click',()=>chooseMap(b.dataset.map)));
chooseMap(selectedMap);
function openControls() { $('controls-dialog').showModal(); }
$('controls-open').addEventListener('click',openControls);
$('copy-link').addEventListener('click',async()=>{
  try { await navigator.clipboard.writeText(new URL('.',location.href).href);$('copy-link').textContent='Link copied ✓'; }
  catch { $('copy-link').textContent='Copy the browser address'; }
  setTimeout(()=>{$('copy-link').textContent='Copy game link';},3000);
});
$('controls-playing').addEventListener('click',openControls);
$('controls-dialog').addEventListener('click',(e)=>{if(e.target===$('controls-dialog'))$('controls-dialog').close();});
$('controls-dialog').addEventListener('close',()=>{if(started)$('game').focus();});
$('retry').addEventListener('click',()=>location.reload());
$('fullscreen').addEventListener('click',async()=>{
  try { if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();$('game').focus(); } catch {}
});
$('leave').addEventListener('click',()=>{if(engine)engine.requestQuit();else location.reload();});
const mb=(bytes)=>(bytes/1048576).toFixed(1);
function showError(error) {
  console.error(error);
  $('launcher').hidden=false;$('game-tools').hidden=true;$('launcher').classList.remove('loading');$('loading').hidden=true;$('error').hidden=false;
  $('error-detail').textContent=error.message || 'Please reload and try again.';
  $('play').disabled=true;downloading=false;
}
async function hash(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''); }
async function getManifest() {
  const response=await nativeFetch('game-manifest.json',{cache:'no-store'});
  if(!response.ok)throw new Error('The game files could not be found. Please try again shortly.');
  return response.json();
}
async function downloadFile(entry,onBytes,cache) {
  const output=new Uint8Array(entry.bytes);
  let next=0;
  async function worker() {
    while(next<entry.parts.length) {
      const part=entry.parts[next++];let compressed;
      const saved=cache?await cache.match(part.url).catch(()=>null):null;
      if(saved)compressed=await saved.arrayBuffer();
      if(!compressed || await hash(compressed)!==part.sha256) {
        const response=await nativeFetch(part.url,{signal:AbortSignal.timeout(120000)});
        if(!response.ok)throw new Error('A game download was interrupted. Check your connection and try again.');
        compressed=await response.arrayBuffer();
        if(compressed.byteLength!==part.bytes || await hash(compressed)!==part.sha256)throw new Error('A game file did not verify. Please retry the download.');
        if(cache)await cache.put(part.url,new Response(compressed)).catch(()=>{});
      }
      const decoded=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      if(decoded.byteLength!==part.rawBytes)throw new Error('A game file could not be unpacked. Please retry.');
      output.set(new Uint8Array(decoded),part.offset);onBytes(part.bytes);
    }
  }
  await Promise.all([worker(),worker()]);
  return output;
}
window.addEventListener('alpine-ready',()=>{
  started=true;downloading=false;$('launcher').hidden=true;$('game-tools').hidden=false;$('game').focus();
  window.dispatchEvent(new CustomEvent('alpine-web-state',{detail:'ready'}));
});
async function launch() {
  if(downloading || started)return;
  if(!window.Engine || !Engine.isWebGLAvailable(2)){showError(new Error('Alpine Pop needs WebGL 2. Enable graphics acceleration and try a current Chrome, Edge or Firefox desktop browser.'));return;}
  if(!window.DecompressionStream || !crypto.subtle){showError(new Error('Please open this game in an up-to-date browser over HTTPS.'));return;}
  downloading=true;$('play').disabled=true;$('launcher').classList.add('loading');$('loading').hidden=false;$('error').hidden=true;
  try {
    manifest=await getManifest();
    const cache=window.caches?await window.caches.open(CACHE).catch(()=>null):null;
    const total=Object.values(manifest.files).reduce((s,f)=>s+f.parts.reduce((n,p)=>n+p.bytes,0),0);let done=0;
    const update=(bytes)=>{done+=bytes;$('progress').value=Math.min(100,done/total*100);$('amount').textContent=`${mb(done)} / ${mb(total)} MB`;$('status').textContent='Loading your mountain';};update(0);
    let [pack,wasm]=await Promise.all([downloadFile(manifest.files['index.pck'],update,cache),downloadFile(manifest.files['index.wasm'],update,cache)]);
    $('status').textContent='Preparing the mountain. This may take a moment.';$('amount').textContent='Download complete';
    // Godot's documented loader fetches <base>.wasm. Supply the already verified
    // bytes for this one local URL; every other request uses the original fetch.
    const wasmURL=new URL('game/index.wasm',location.href).href;
    window.fetch=(input,options)=>{
      const url=new URL(input instanceof Request?input.url:String(input),location.href).href;
      return url===wasmURL ? Promise.resolve(new Response(wasm,{headers:{'Content-Type':'application/wasm'}})) : nativeFetch(input,options);
    };
    engine=new Engine({canvas:$('game'),executable:'game/index',canvasResizePolicy:2,focusCanvas:true,persistentPaths:['/userfs'],onExit:()=>location.reload(),onPrint:(...args)=>console.log(...args),onPrintError:(...args)=>console.error(...args)});
    try { await engine.init('game/index'); } finally { window.fetch=nativeFetch;wasm=null; }
    await engine.preloadFile(pack,'index.pck');pack=null;
    await new Promise(requestAnimationFrame);
    await engine.start({args:['--main-pack','index.pck','--','--map='+selectedMap]});
  } catch(error) { window.fetch=nativeFetch;showError(error); }
}
$('play').addEventListener('click',launch);
getManifest().then((m)=>{
  const total=Object.values(m.files).reduce((s,f)=>s+f.parts.reduce((n,p)=>n+p.bytes,0),0);
  $('download-note').textContent=`First launch: ${Math.ceil(total/1048576)} MB, then cached for later visits. Desktop browser recommended. Updates arrive here.`;
}).catch(()=>{});
if(window.matchMedia('(pointer: coarse)').matches)$('save-note').textContent='Keyboard or controller required · No touch controls yet';
