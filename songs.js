/* ── Hanzi · Songs ─────────────────────────────────────────────
   Lyrics, line by line, with pinyin under each word and an English
   line. Everything runs on the phone: OpenCC for 简/繁, a bundled
   CC-CEDICT for segmentation, pinyin and glosses, pdf.js for PDFs and
   Tesseract for photos. No lyrics ship with the app.

   Song      {id,title,titleTrad,titlePinyin,englishTitle,artist,
              sourceScript:'simplified'|'traditional',createdAt,lines}
   LyricLine {index,simplified,traditional,pinyin,english,tokens,
              englishCheck,pinyinEdited,englishEdited}
   Token     {simplified,traditional,pinyin,matchType:'none'|'hsk'|'note',
              hskEntryId?,noteId?}                                     */

/* ── store ─────────────────────────────────────────────────── */
function loadSongs(){try{const v=JSON.parse(localStorage.getItem(slot('songs')));
  return Array.isArray(v)?v:[]}catch(e){return []}}
let SG=loadSongs();
function saveSongs(){ return put(slot('songs'),SG) }
function reloadSongs(){ SG=loadSongs() }
const songScript=()=>S.songScript==='t'?'t':'s';

/* ── lazy libraries ────────────────────────────────────────── */
const loaded={};
function loadScript(src){
  return loaded[src]||(loaded[src]=new Promise((ok,no)=>{
    const s=document.createElement('script'); s.src=src; s.onload=ok;
    s.onerror=()=>{delete loaded[src]; no(new Error('Could not load '+src))};
    document.head.appendChild(s);
  }));
}
let CV=null;                 // {s2t,t2s}
async function needOpenCC(){
  if(CV) return CV;
  await loadScript('vendor/opencc.js');
  const s2t=OpenCC.Converter({from:'cn',to:'hk'});
  const h2s=OpenCC.Converter({from:'hk',to:'cn'}), w2s=OpenCC.Converter({from:'twp',to:'cn'});
  CV={s2t, t2s:x=>w2s(h2s(x))};
  return CV;
}
let CED=null, CEDMAX=1;      // simplified → [pinyin, gloss]
let cedPending=null;
function needCedict(){
  if(CED) return Promise.resolve(CED);
  return cedPending||(cedPending=fetch('data/cedict.txt').then(r=>{
    if(!r.ok) throw new Error('dictionary'); return r.text()}).then(t=>{
    const m=new Map();
    for(const ln of t.split('\n')){
      const a=ln.indexOf('\t'), b=ln.indexOf('\t',a+1); if(a<0) continue;
      const w=ln.slice(0,a); m.set(w,[ln.slice(a+1,b<0?undefined:b), b<0?'':ln.slice(b+1)]);
      if(w.length>CEDMAX) CEDMAX=w.length;
    }
    CED=m; return m;
  }).catch(e=>{cedPending=null; throw e}));
}

/* ── indexes over notes and the HSK library ────────────────── */
const PUNCT=/[\s，。！？、；：,.!?;:'"“”‘’…—\-（）()《》「」『』~～·]/g;
let IDX=null;
function buildIdx(){
  const note=new Map(), hsk=new Map(); let max=1;
  const addNote=(h,rec)=>{
    const k=(h||'').replace(PUNCT,'');
    if(!k||![...k].every(isHan)||note.has(k)) return;
    note.set(k,rec); if([...k].length>max) max=[...k].length;
  };
  // my own first: it carries your own wording
  M.forEach(m=>addNote(m.h,{id:'u:'+m.id,h:m.h,p:m.p,e:m.e,title:m.h,
    excerpt:m.e,src:'My own'}));
  D.notes.vocab.forEach(v=>addNote(v.h,{id:'v:'+v.id,h:v.h,p:v.p,e:v.e,title:v.h,
    excerpt:v.e+(v.l?' · '+v.l:''),src:'My notes'}));
  D.hsk.words.forEach(w=>{ if(!hsk.has(w.h)) hsk.set(w.h,{id:'h:'+w.h,h:w.h,p:w.p,e:w.e,lv:w.lv});
    if(w.h.length>max) max=w.h.length });
  IDX={note,hsk,max:Math.min(max,12)};
  return IDX;
}
const idx=()=>IDX||buildIdx();
function idxSig(){ return [M.length,M.map(m=>m.h+m.p).join('|').length,D.notes.vocab.length,D.hsk.words.length].join('.') }
function notesChanged(){ IDX=null; rematchAll() }

/* ── pinyin helpers ────────────────────────────────────────── */
// one syllable per character, or null if it won't line up
function sylls(p,n){
  if(!p) return null;
  let s=p.replace(/['’·]/g,' ').trim().split(/\s+/).filter(Boolean);
  if(s.length!==n) s=splitPinyin(p.replace(/['’·]/g,' '));
  return s.length===n?s:null;
}
function charPy(c){
  const ch=CHARIDX.get(c); if(ch&&ch.p) return ch.p.split(/[,;\s]/)[0];
  const w=WORDIDX.get(c); if(w&&w.p) return w.p.split(/[,;\s]/)[0];
  const e=CED&&CED.get(c); if(e) return e[0].split(' ')[0];
  return '';
}
function pyFor(w,nHan){
  const ix=idx(), n=ix.note.get(w), h=ix.hsk.get(w), c=CED&&CED.get(w);
  for(const p of [n&&n.p, h&&h.p, c&&c[0]]){ const s=sylls(p,nHan); if(s) return s.join(' ').toLowerCase() }
  return [...w].map(charPy).join(' ').toLowerCase();
}
// 不 / 一 tone change, for display only — the stored pinyin keeps citation tones
const NUMERAL=/[〇零一二三四五六七八九十百千万亿两第]/;
function sandhi(tokens){
  const flat=[];
  tokens.forEach((t,ti)=>{ if(!t.pinyin) return;
    const cs=[...t.simplified], sy=t.pinyin.split(' ');
    cs.forEach((c,k)=>flat.push({c,sy:sy[k]||'',ti,k,last:k===cs.length-1,len:cs.length}));
  });
  const out=tokens.map(t=>t.pinyin?t.pinyin.split(' '):[]);
  for(let i=0;i<flat.length;i++){
    const a=flat[i], b=flat[i+1]; if(!b) continue;
    const next=toneOf(b.sy);
    if(a.c==='不'&&stripTone(a.sy)==='bu'&&next===4) out[a.ti][a.k]='bú';
    if(a.c==='一'&&a.sy==='yī'&&!(a.last&&a.len>1)&&!NUMERAL.test(b.c)&&!(flat[i-1]&&flat[i-1].c==='第'))
      out[a.ti][a.k]= next===4||next===5 ? 'yí' : 'yì';
  }
  return out.map(x=>x.join(''));
}

/* ── segmentation + matching ───────────────────────────────── */
function annotate(t){
  const ix=idx(), k=t.simplified, n=ix.note.get(k), h=ix.hsk.get(k);
  delete t.noteId; delete t.hskEntryId;
  if(n) t.noteId=n.id;
  if(h) t.hskEntryId=h.id;
  t.matchType=n?'note':h?'hsk':'none';
  return t;
}
// longest match across notes, HSK and CC-CEDICT; on a tie notes win, then HSK
function segmentLine(s,t){
  const ix=idx(), cs=[...s], ts=[...(t||'')], same=ts.length===cs.length, out=[];
  const max=Math.max(ix.max,CEDMAX);
  let i=0;
  while(i<cs.length){
    if(!isHan(cs[i])){
      let j=i; while(j<cs.length&&!isHan(cs[j])) j++;
      const raw=cs.slice(i,j).join('');
      out.push({simplified:raw,traditional:same?ts.slice(i,j).join(''):raw,pinyin:'',matchType:'none'});
      i=j; continue;
    }
    let run=i; while(run<cs.length&&isHan(cs[run])) run++;
    let L=Math.min(max,run-i);
    for(;L>1;L--){
      const w=cs.slice(i,i+L).join('');
      if(ix.note.has(w)||ix.hsk.has(w)||(CED&&CED.has(w))) break;
    }
    const w=cs.slice(i,i+L).join('');
    const tr=same?ts.slice(i,i+L).join(''):(CV?CV.s2t(w):w);
    out.push(annotate({simplified:w,traditional:tr,pinyin:pyFor(w,L)}));
    i+=L;
  }
  return out;
}
const linePinyin=toks=>{
  let s='';
  for(const t of toks){
    if(!t.pinyin){ const r=t.simplified.trim(); if(!r){ continue }
      const m=[...r].map(c=>PUNC[c]||c).join('');
      s+= /^[,.?!:;"…]+$/.test(m)?m:(s?' ':'')+m; continue }
    s+=(s?' ':'')+t.pinyin.replace(/ /g,'');
  }
  return s.trim();
};
const PARTICLE=new Set(['的','了','吗','呢','吧','啊','呀','哦','嘛','着','过','地','得','啦','喔','哟','么']);
function glossOf(w){
  const ix=idx(), n=ix.note.get(w), h=ix.hsk.get(w), c=CED&&CED.get(w);
  const raw=(n&&n.e)||(h&&h.e)||(c&&c[1])||'';
  let g=(raw||'').replace(/\([^)]*\)?/g,'').split(/[;·,\/]/)[0].replace(/[!！]/g,'').trim().replace(/^to\s+/i,'');
  if(/^[A-Z][a-z]/.test(g)&&!/^I\b/.test(g)) g=g[0].toLowerCase()+g.slice(1);
  return g.slice(0,32);
}
function glossLine(toks){
  return toks.filter(t=>t.pinyin&&!PARTICLE.has(t.simplified))
    .map(t=>glossOf(t.simplified)||t.simplified).join(' ').replace(/\s+/g,' ').trim()
    .replace(/^./,c=>c.toUpperCase());
}
// pinyin as shown: 不 / 一 tone changes applied, one word per token
const showPy=l=>{ const sy=sandhi(l.tokens); return linePinyin(l.tokens.map((t,i)=>t.pinyin?{...t,pinyin:sy[i]}:t)) };

/* ── import + cleaning ─────────────────────────────────────── */
const hasCJK=s=>[...s].some(isHan);
const LABEL=/^(副歌|主歌|间奏|間奏|前奏|尾奏|桥段|橋段|过门|過門|重复|重複|合唱|男|女|合|独白|獨白|rap|verse|chorus|pre-?chorus|bridge|intro|outro|hook|refrain|repeat|interlude)\s*\d*$/i;
const CREDIT=/^(作词|作詞|作曲|编曲|編曲|词|詞|曲|演唱|原唱|歌手|制作人|製作人|监制|監製|和声|和聲|混音|母带|母帶|吉他|贝斯|貝斯|鼓|弦乐|弦樂|录音|錄音|出品|发行|發行|OP|SP|ISRC|Lyrics?|Composer|Producer)\s*[:：]/i;
function cleanText(text){
  let labels=0;
  const out=[];
  for(let ln of text.replace(/\r\n?/g,'\n').split('\n')){
    ln=ln.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g,'')                 // LRC times
         .replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g,'') // SRT
         .replace(/<[^>]+>/g,'').replace(/[　 \t]/g,' ').trim();
    if(!ln) continue;
    if(/^\[[a-z]+:.*\]$/i.test(ln)) continue;                               // [ar:…] metadata
    if(/^\d+$/.test(ln)) continue;                                          // SRT index
    const br=ln.match(/^[\[【〔(（](.*)[\]】〕)）]$/);
    if(br&&(!hasCJK(br[1])||LABEL.test(br[1].trim())||/^[x×✕*＊]\s*\d+$/i.test(br[1].trim()))){labels++;continue}
    if(LABEL.test(ln.replace(/[:：]$/,'').trim())){labels++;continue}
    if(CREDIT.test(ln)) continue;
    const before=ln;
    ln=ln.replace(/\s*[(（]?\s*[x×✕*＊]\s*\d+\s*[)）]?\s*$/i,'').replace(/^\s*[(（]?\s*[x×✕*＊]\s*\d+\s*[)）]?\s*/i,'');
    if(ln!==before) labels++;
    ln=ln.replace(/\s{2,}/g,' ').trim();
    if(!hasCJK(ln)) continue;
    out.push(ln);
  }
  return {lines:out.slice(0,400),labels};
}
function detectScript(lines){
  if(!CV) return 'simplified';
  let s=0,t=0;
  for(const c of lines.join('')){ if(!isHan(c)) continue;
    if(CV.t2s(c)!==c) t++; else if(CV.s2t(c)!==c) s++ }
  return t>s?'traditional':'simplified';
}
async function decodeBytes(buf){
  const u8=new Uint8Array(buf);
  if(u8[0]===0xEF&&u8[1]===0xBB&&u8[2]===0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
  if(u8[0]===0xFF&&u8[1]===0xFE) return new TextDecoder('utf-16le').decode(u8);
  if(u8[0]===0xFE&&u8[1]===0xFF) return new TextDecoder('utf-16be').decode(u8);
  try{ return new TextDecoder('utf-8',{fatal:true}).decode(u8) }catch(e){}
  // GB18030 decodes almost anything without complaint, so a Big5 file would come
  // out as garbage rather than failing over. Decode both and keep the one that
  // reads as real Chinese.
  await needOpenCC().catch(()=>{});
  let best='',bs=-1e9;
  for(const enc of ['gb18030','big5']){
    let txt; try{ txt=new TextDecoder(enc).decode(u8) }catch(e){ continue }
    let sc=0;
    for(const c of txt){ if(c==='�') sc-=5; else if(isHan(c)) sc+=CHARIDX.has(CV?CV.t2s(c):c)?1:-1 }
    if(sc>bs){bs=sc;best=txt}
  }
  return best;
}
async function pdfText(file){
  const pdfjs=await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='vendor/pdfjs/pdf.worker.min.mjs';
  // CJK PDFs that use the standard Adobe character maps need these to read as text
  const doc=await pdfjs.getDocument({data:await file.arrayBuffer(),cMapUrl:'vendor/pdfjs/cmaps/',cMapPacked:true}).promise;
  let out='';
  for(let i=1;i<=doc.numPages;i++){
    const tc=await (await doc.getPage(i)).getTextContent();
    for(const it of tc.items){ out+=it.str||''; if(it.hasEOL) out+='\n' }
    out+='\n';
  }
  return out;
}
let ocrWorker=null;
async function ocrImage(file,onStatus){
  await loadScript('vendor/tesseract/tesseract.min.js');
  if(!ocrWorker){
    onStatus&&onStatus('Loading the text reader…');
    ocrWorker=await Tesseract.createWorker(['chi_sim','chi_tra'],1,{
      workerPath:'vendor/tesseract/worker.min.js',
      corePath:'vendor/tesseract/',
      langPath:'vendor/tesseract/lang',
      workerBlobURL:false, gzip:true,
      logger:m=>{ if(m.status==='recognizing text'&&onStatus) onStatus('Reading the photo… '+Math.round(m.progress*100)+'%') }
    });
  }
  onStatus&&onStatus('Reading the photo…');
  const {data}=await ocrWorker.recognize(file);
  // Tesseract puts spaces between CJK characters; take them back out
  return (data.text||'').replace(/([㐀-鿿豈-﫿，。！？、])[ \t]+(?=[㐀-鿿豈-﫿，。！？、])/g,'$1');
}

/* ── the pipeline ──────────────────────────────────────────── */
async function tryTranslate(lines){
  // Safari has no on-device translator today; use one if the browser ever offers it
  try{
    if(!('Translator' in self)) return null;
    // only a model already on the device: a download would hang offline
    const within=(pr,ms)=>Promise.race([pr,new Promise((_,no)=>setTimeout(()=>no(new Error('timeout')),ms))]);
    const av=await within(Translator.availability({sourceLanguage:'zh',targetLanguage:'en'}),3000);
    if(av!=='available') return null;
    const tr=await within(Translator.create({sourceLanguage:'zh',targetLanguage:'en'}),5000);
    const out=[]; for(const l of lines) out.push(await within(tr.translate(l),5000));
    return out;
  }catch(e){ return null }
}
function buildLine(s,t,i){
  const toks=segmentLine(s,t);
  return {index:i,simplified:s,traditional:t,tokens:toks,pinyin:linePinyin(toks),
    english:'',englishCheck:true,pinyinEdited:false,englishEdited:false};
}
function bothScripts(line,src){
  let s,t;
  if(src==='traditional'){ t=line; s=CV.t2s(line) } else { s=line; t=CV.s2t(line) }
  if([...s].length!==[...t].length){ // phrase conversion changed the length; go char by char
    if(src==='traditional') s=[...t].map(c=>CV.t2s(c)).join('');
    else t=[...s].map(c=>CV.s2t(c)).join('');
  }
  return {s,t};
}
async function generateSong(draft,onStatus){
  onStatus('Loading the dictionary…');
  await Promise.all([needOpenCC(),needCedict()]);
  IDX=null;
  const {lines}=cleanText(draft.text);
  const src=detectScript(lines);
  onStatus('Segmenting '+lines.length+' lines…');
  const L=lines.map((ln,i)=>{const {s,t}=bothScripts(ln,src); return buildLine(s,t,i)});
  onStatus('English…');
  const mt=await tryTranslate(L.map(l=>l.simplified));
  L.forEach((l,i)=>{
    if(mt&&mt[i]){ l.english=mt[i]; l.englishCheck=false }
    else { l.english=glossLine(l.tokens); l.englishCheck=true }
  });
  const tt=bothScripts(draft.title.trim()||lines[0]||'',hasCJK(draft.title)&&CV.t2s(draft.title)!==draft.title?'traditional':'simplified');
  const ttoks=segmentLine(tt.s,tt.t);
  return {
    id:draft.id||Date.now().toString(36), createdAt:draft.createdAt||Date.now(),
    title:tt.s, titleTrad:tt.t, titlePinyin:linePinyin(ttoks),
    englishTitle:draft.englishTitle||glossLine(ttoks).replace(/^./,c=>c.toUpperCase()),
    artist:draft.artist.trim(), sourceScript:src, lines:L
  };
}
// Re-run matching after a note or library change. A line whose pinyin you
// corrected keeps its words; only the match flags are refreshed.
function rematchSong(song){
  for(const l of song.lines){
    if(l.pinyinEdited||!CED){ l.tokens.forEach(t=>{ if(t.pinyin) annotate(t) }); continue }
    l.tokens=segmentLine(l.simplified,l.traditional);
    l.pinyin=linePinyin(l.tokens);
  }
}
async function rematchAll(){
  if(!SG.length) return;
  try{ await Promise.all([needOpenCC(),needCedict()]) }catch(e){}
  IDX=null; SG.forEach(rematchSong); saveSongs();
  put(slot('songsig'),idxSig());
  if(cur==='songs') fillSongs();
}
function checkSig(){
  let old=null; try{old=JSON.parse(localStorage.getItem(slot('songsig')))}catch(e){}
  if(SG.length&&old!==idxSig()) rematchAll();
}

/* ── counts ────────────────────────────────────────────────── */
function counts(song){
  const h=new Set(), n=new Set();
  song.lines.forEach(l=>l.tokens.forEach(t=>{
    if(t.matchType==='note') n.add(t.simplified); else if(t.matchType==='hsk') h.add(t.simplified)}));
  return {hsk:h.size,notes:n.size};
}
const tTitle=s=>songScript()==='t'?(s.titleTrad||s.title):s.title;
const firstHan=s=>[...s].find(isHan)||s[0]||'?';

/* ── 3a · library ──────────────────────────────────────────── */
let songQuery='';
function scriptSeg(id){
  return `<div class="sseg" id="${id}">
    <button data-s="s" class="${songScript()==='s'?'on':''}">简</button>
    <button data-s="t" class="${songScript()==='t'?'on':''}">繁</button></div>`;
}
function wireScript(id,after){
  $$('#'+id+' button').forEach(b=>b.onclick=()=>{
    S.songScript=b.dataset.s; saveS(); needOpenCC().catch(()=>{}); after()});
}
function renderSongs(){
  const s=$('#songs');
  checkSig();
  s.innerHTML=`
  <div class="sgtop">
    <div class="h1">Songs</div>
    <div class="sgact">${scriptSeg('sgScript')}
      <button class="libadd big" id="sgAdd" aria-label="Add song">+</button></div>
  </div>
  <div class="search">
    ${svg('search',15,'var(--ink5)')}
    <input id="sgSearch" placeholder="Search titles, artists or lyrics" value="${esc(songQuery)}" autocomplete="off" autocorrect="off" spellcheck="false">
  </div>
  <div class="sghead"${SG.length?'':' hidden'}><span class="eyebrow" id="sgN"></span><span class="sgsort">Recently added</span></div>
  <div id="sgBody"></div>`;
  wireScript('sgScript',renderSongs);
  $('#sgAdd').onclick=()=>openAdd();
  const inp=$('#sgSearch'); inp.oninput=()=>{songQuery=inp.value; fillSongs()};
  fillSongs();
}
function fillSongs(){
  const body=$('#sgBody'); if(!body) return;
  const q=songQuery.trim().toLowerCase(), qq=stripTone(q).replace(/\s/g,'');
  const list=SG.slice().sort((a,b)=>b.createdAt-a.createdAt).filter(sg=>!q||
    [sg.title,sg.titleTrad,sg.artist,sg.englishTitle].some(x=>(x||'').toLowerCase().includes(q))||
    stripTone(sg.titlePinyin||'').replace(/\s/g,'').includes(qq)||
    sg.lines.some(l=>l.simplified.includes(songQuery.trim())||l.traditional.includes(songQuery.trim())));
  $('#sgN').textContent=SG.length?`${list.length} song${list.length===1?'':'s'}`:'';
  if(!SG.length){ body.innerHTML=`<div class="empty">No songs yet.<br>Tap + to add lyrics — paste them, open a TXT, LRC, SRT or PDF, or take a photo of printed lyrics.</div>`; return }
  if(!list.length){ body.innerHTML='<div class="empty">Nothing matches that search.</div>'; return }
  body.innerHTML='<div class="card sglist"></div>';
  const box=$('.sglist',body);
  list.forEach((sg,i)=>{
    const c=counts(sg), t=tTitle(sg);
    const r=el('button','srow',`
      <div class="smono han${i===0&&!q?' dark':''}">${esc(firstHan(t))}</div>
      <div class="sm">
        <div class="st han">${esc(t)}</div>
        <div class="ss">${esc(sg.titlePinyin||'')}${sg.englishTitle?` · <i>${esc(sg.englishTitle)}</i>`:''}</div>
        <div class="sa">${esc(sg.artist||'')}<span>${sg.lines.length} line${sg.lines.length===1?'':'s'}</span></div>
      </div>
      <div class="sbadges">
        ${c.hsk?`<span class="badge hsk">${c.hsk} HSK</span>`:''}
        ${c.notes?`<span class="badge note">${c.notes} NOTES</span>`:''}
      </div>`);
    r.onclick=()=>openLyrics(sg.id);
    box.appendChild(r);
  });
}

/* ── 3b / 3f · lyrics view ─────────────────────────────────── */
const SIZES=[.8,.9,1,1.12,1.25];
let LY=null; // {id, active:{li,ti}}
function lyHost(){
  let h=$('#lyrics'); if(!h){ h=el('div','lyrics'); h.id='lyrics'; document.body.appendChild(h) }
  return h;
}
function openLyrics(id){
  LY={id,active:null};
  const h=lyHost(); h.classList.add('on');
  const m=$('meta[name="theme-color"]'); if(m) m.content=document.documentElement.dataset.theme==='dark'?'#14120F':'#7C3A22';
  if(songScript()==='t') needOpenCC().catch(()=>{});
  renderLyrics();
}
function closeLyrics(){
  closePhrase(); const h=$('#lyrics'); if(h) h.classList.remove('on'); LY=null; applyTheme();
  if(cur==='songs') fillSongs();
}
function renderLyrics(){
  const sg=SG.find(x=>x.id===LY.id); if(!sg) return closeLyrics();
  const h=lyHost(), tr=songScript()==='t';
  const py=S.lyPy!==false, en=S.lyEn!==false, links=S.lyLinks!==false;
  const k=SIZES[S.lySize==null?2:S.lySize]||1;
  h.style.setProperty('--k',k);
  h.innerHTML=`
  <div class="lyhead">
    <button class="lyx" id="lyClose" aria-label="Close"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7.5l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <button class="lytitle" id="lyEdit" title="Edit lines">
      <div class="han">${esc(tTitle(sg))}</div><div class="lyart">${esc(sg.artist||'')}</div></button>
    ${scriptSeg('lyScript')}
  </div>
  ${links?`<div class="lylegend"><span><i class="ul"></i>HSK library</span><span><i class="gd"></i>My notes</span></div>`:''}
  <div class="lybody" id="lyBody">${sg.lines.map((l,li)=>{
    const sy=sandhi(l.tokens);
    return `<div class="lyl">
      <div class="lytoks">${l.tokens.map((t,ti)=>{
        const z=tr?t.traditional:t.simplified;
        if(!t.pinyin) return z.trim()?`<span class="tk raw"><span class="tz">${esc(z)}</span>${py?'<span class="tp">&nbsp;</span>':''}</span>`:'<span class="tk sp"></span>';
        const m=links&&t.matchType!=='none'?t.matchType:'';
        const act=LY.active&&LY.active.li===li&&LY.active.ti===ti;
        return `<${m?'button':'span'} class="tk${m?' m-'+m:''}${act?' act':''}" data-li="${li}" data-ti="${ti}">
          <span class="tz">${esc(z)}</span>${py?`<span class="tp">${esc(sy[ti])}</span>`:''}</${m?'button':'span'}>`;
      }).join('')}</div>
      ${en&&l.english?`<div class="lyen">${esc(l.english)}</div>`:''}
    </div>`}).join('')}<div style="height:120px"></div></div>
  <div class="lypills">
    <button class="pl${py?' on':''}" data-k="lyPy">Pinyin</button>
    <button class="pl${en?' on':''}" data-k="lyEn">English</button>
    <button class="pl${links?' on':''}" data-k="lyLinks">Links</button>
    <span class="pldiv"></span>
    <span class="pl aa"><button id="lyMinus" aria-label="Smaller">−</button><b>Aa</b><button id="lyPlus" aria-label="Larger">+</button></span>
  </div>`;
  $('#lyClose').onclick=closeLyrics;
  $('#lyEdit').onclick=()=>openReview(structuredClone(sg),{existing:true});
  wireScript('lyScript',()=>{ needOpenCC().then(renderLyrics,renderLyrics) });
  $$('.lypills .pl[data-k]',h).forEach(b=>b.onclick=()=>{
    const key=b.dataset.k; S[key]=S[key]===false; saveS(); keepScroll(renderLyrics)});
  const size=d=>{S.lySize=Math.max(0,Math.min(SIZES.length-1,(S.lySize==null?2:S.lySize)+d)); saveS(); keepScroll(renderLyrics)};
  $('#lyMinus').onclick=()=>size(-1); $('#lyPlus').onclick=()=>size(1);
  $$('#lyBody button.tk',h).forEach(b=>b.onclick=()=>openPhrase(sg,+b.dataset.li,+b.dataset.ti));
}
function keepScroll(fn){ const b=$('#lyBody'), y=b?b.scrollTop:0; fn(); const n=$('#lyBody'); if(n) n.scrollTop=y }

/* ── 3c · phrase sheet ─────────────────────────────────────── */
function openPhrase(sg,li,ti){
  const t=sg.lines[li].tokens[ti]; LY.active={li,ti}; keepScroll(renderLyrics);
  const ix=idx(), note=t.noteId?[...ix.note.values()].find(n=>n.id===t.noteId):null;
  const hsk=t.hskEntryId?ix.hsk.get(t.hskEntryId.slice(2)):null;
  const z=songScript()==='t'?t.traditional:t.simplified;
  const others=SG.filter(o=>o.id!==sg.id&&o.lines.some(l=>l.tokens.some(x=>x.simplified===t.simplified))).slice(0,3);
  const gloss=(note&&note.e)||(hsk&&firstEn(hsk.e))||glossOf(t.simplified);
  let p=$('#phrase'); if(!p){ p=el('div','phrase'); p.id='phrase'; document.body.appendChild(p) }
  p.innerHTML=`<div class="phscrim"></div><div class="phpanel">
    <div class="phgrab"></div>
    <div class="phhero"><div class="phz han">${esc(z)}</div>
      <div><div class="phpy">${esc(sandhi(sg.lines[li].tokens)[ti])}</div><div class="phgl">${esc(gloss)}</div></div></div>
    ${note?`<button class="phnote" id="phNote"><div><div class="eyebrow">From ${esc(note.src)}</div>
      <div class="phnt">${esc(note.title)}</div><div class="phnx">${esc(note.excerpt||'')}</div></div>${chev()}</button>`:''}
    ${hsk?`<button class="phrow" id="phHsk"><span class="badge hsk">HSK ${hsk.lv}</span><span>Open in library</span>${chev()}</button>`:''}
    ${others.map(o=>`<button class="phrow" data-sid="${o.id}"><span>Also in <span class="han">${esc(tTitle(o))}</span></span>${chev()}</button>`).join('')}
  </div>`;
  p.classList.add('on');
  $('.phscrim',p).onclick=closePhrase;
  const nb=$('#phNote'); if(nb) nb.onclick=()=>openChar(note.h,{p:note.p,e:note.e});
  const hb=$('#phHsk'); if(hb) hb.onclick=()=>openChar(hsk.h,{p:hsk.p,e:hsk.e});
  $$('.phrow[data-sid]',p).forEach(b=>b.onclick=()=>{closePhrase();openLyrics(b.dataset.sid)});
}
function closePhrase(){ const p=$('#phrase'); if(p) p.classList.remove('on');
  if(LY&&LY.active){LY.active=null; keepScroll(renderLyrics)} }
const chev=()=>'<svg class="chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 1.5l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ── 3d · add song ─────────────────────────────────────────── */
let AD=null;
function flow(){ let f=$('#songflow'); if(!f){ f=el('div','songflow'); f.id='songflow'; document.body.appendChild(f) } f.classList.add('on'); return f }
function closeFlow(){ const f=$('#songflow'); if(f) f.classList.remove('on'); AD=null }
const SRCI={
  paste:'<rect x="5" y="3.5" width="10" height="13" rx="2"/><path d="M8 3.5V2.5h4v1"/>',
  file:'<path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z" stroke-linejoin="round"/><path d="M11.5 2.5V6H15"/>',
  photo:'<rect x="2.5" y="5" width="15" height="11" rx="2"/><circle cx="10" cy="10.5" r="3"/><path d="M7 5l1.2-2h3.6L13 5"/>'
};
function openAdd(){
  AD={title:'',artist:'',text:'',src:null,file:null,labels:0};
  needOpenCC().catch(()=>{}); needCedict().catch(()=>{});
  renderAdd();
}
function renderAdd(){
  const f=flow();
  f.innerHTML=`
  <div class="fbar"><button id="adCancel">Cancel</button><b>New song</b><button id="adSave" disabled>Save</button></div>
  <div class="fbody">
    <div class="card fgroup">
      <label><span>Title</span><input id="adTitle" class="han" value="${esc(AD.title)}" placeholder="歌名" autocomplete="off" autocorrect="off" spellcheck="false"></label>
      <label><span>Artist</span><input id="adArtist" value="${esc(AD.artist)}" placeholder="Artist" autocomplete="off" autocorrect="off" spellcheck="false"></label>
    </div>
    <div class="eyebrow" style="margin:22px 2px 10px">Add lyrics from</div>
    <div class="srcs">${['paste','file','photo'].map(k=>`<button data-src="${k}" class="${AD.src===k?'on':''}">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">${SRCI[k]}</svg>
      <span>${k[0].toUpperCase()+k.slice(1)}</span></button>`).join('')}</div>
    ${AD.file?`<div class="fchip"><span class="ftype">${esc(AD.file.type)}</span><span class="fname">${esc(AD.file.name)}</span><button id="adReplace">Replace</button></div>`:''}
    <textarea id="adText" class="han" placeholder="Paste or type lyrics here — one line per line of the song" autocorrect="off" spellcheck="false">${esc(AD.text)}</textarea>
    <div class="fmeta"><span id="adDetect"></span><span id="adLabels"></span></div>
    <div class="merr" id="adErr" hidden></div>
    <button class="btn" id="adGo">Generate pinyin + English</button>
  </div>
  <input type="file" id="adFile" hidden accept=".txt,.lrc,.srt,.pdf,text/plain,application/pdf">
  <input type="file" id="adPhoto" hidden accept="image/*">`;
  const T=$('#adTitle'),A=$('#adArtist'),X=$('#adText');
  T.oninput=()=>AD.title=T.value; A.oninput=()=>AD.artist=A.value;
  X.oninput=()=>{AD.text=X.value; meta()};
  $('#adCancel').onclick=closeFlow;
  $$('.srcs button').forEach(b=>b.onclick=()=>pickSource(b.dataset.src));
  const rp=$('#adReplace'); if(rp) rp.onclick=()=>pickSource(AD.src==='photo'?'photo':'file');
  $('#adFile').onchange=e=>{const fl=e.target.files[0]; if(fl) importFile(fl)};
  $('#adPhoto').onchange=e=>{const fl=e.target.files[0]; if(fl) importPhoto(fl)};
  $('#adGo').onclick=runGenerate;
  meta();
}
function meta(){
  const d=$('#adDetect'); if(!d) return;
  const {lines,labels}=cleanText(AD.text);
  d.textContent=lines.length?`Detected: ${CV?detectScript(lines):'simplified'} · ${lines.length} line${lines.length===1?'':'s'}`:'';
  $('#adLabels').textContent=(AD.labels||labels)?'Section labels removed':'';
}
function setText(raw,src,file){
  const {lines,labels}=cleanText(raw);
  AD.text=lines.join('\n'); AD.labels=labels; AD.src=src; AD.file=file||null;
  renderAdd();
  if(!lines.length) adErr('No Chinese lines found in that '+(src==='paste'?'clipboard text':src)+'.');
}
const adErr=t=>{const e=$('#adErr'); if(e){e.textContent=t; e.hidden=!t}};
const busy=(on,label)=>{const b=$('#adGo'); if(!b) return; b.disabled=on; b.textContent=on?label:'Generate pinyin + English'};
async function pickSource(k){
  adErr('');
  if(k==='paste'){
    try{ const t=await navigator.clipboard.readText();
      if(t&&t.trim()) return setText(t,'paste');
      adErr('The clipboard is empty — copy the lyrics first.');
    }catch(e){
      AD.src='paste'; renderAdd(); $('#adText').focus();
      adErr('Long-press in the box and tap Paste.');
    }
    return;
  }
  (k==='file'?$('#adFile'):$('#adPhoto')).click();
}
async function importFile(fl){
  const ext=(fl.name.split('.').pop()||'').toLowerCase();
  busy(true,'Reading '+fl.name+'…');
  try{
    let raw;
    if(ext==='pdf'||fl.type==='application/pdf') raw=await pdfText(fl);
    else raw=await decodeBytes(await fl.arrayBuffer());
    setText(raw,'file',{type:(ext||'txt').toUpperCase(),name:fl.name});
  }catch(e){ busy(false); adErr(navigator.onLine||ext!=='pdf'?'Could not read that file.':'Open the app online once so PDF support can download.') }
}
async function importPhoto(fl){
  busy(true,'Reading the photo…');
  try{
    const raw=await ocrImage(fl,s=>busy(true,s));
    setText(raw,'photo',{type:'IMG',name:fl.name||'photo.jpg'});
  }catch(e){ busy(false); adErr(navigator.onLine?'Could not read text in that photo.':'Open the app online once so the photo reader can download.') }
}
async function runGenerate(){
  const {lines}=cleanText(AD.text);
  if(!lines.length) return adErr('Add some lyrics first — at least one line with Chinese characters.');
  if(!AD.title.trim()) return adErr('Add a title.');
  try{
    const song=await generateSong(AD,s=>busy(true,s));
    openReview(song,{existing:false});
  }catch(e){ busy(false); adErr('The dictionary didn\'t load. Open the app online once, then try again.') }
}

/* ── 3e · review generated lines ───────────────────────────── */
let RV=null;
function openReview(song,{existing}){ RV={song,existing,edit:null}; renderRev() }
function renderRev(){
  const f=flow(), sg=RV.song, tr=songScript()==='t';
  const matched=new Set(); sg.lines.forEach(l=>l.tokens.forEach(t=>{if(t.matchType!=='none')matched.add(t.simplified)}));
  const chk=sg.lines.filter(l=>l.englishCheck&&!l.englishEdited).length;
  f.innerHTML=`
  <div class="fbar"><button id="rvBack" aria-label="Back">${svg('back',16,'currentColor')}</button><b>${RV.existing?'Edit lines':'Review lines'}</b><button id="rvSave" class="red">Save</button></div>
  <div class="fbody">
    <div class="rvhead">
      <label><span>Title</span><input id="rvTitle" class="han" value="${esc(tr?sg.titleTrad||sg.title:sg.title)}"></label>
      <label><span>English title</span><input id="rvEn" value="${esc(sg.englishTitle||'')}"></label>
      <label><span>Artist</span><input id="rvArt" value="${esc(sg.artist||'')}"></label>
    </div>
    <p class="rvnote">Pinyin and English were generated. Tap any line to correct it. ${matched.size} phrase${matched.size===1?'':'s'} matched your library and notes.${chk?` <b>${chk}</b> English line${chk===1?' is':'s are'} a word-by-word gloss — marked <span class="badge chk">CHECK</span>.`:''}</p>
    <div id="rvList">${sg.lines.map((l,i)=>RV.edit===i?editRow(l,i):`
      <button class="rvrow" data-i="${i}"><span class="rvn">${String(i+1).padStart(2,'0')}</span>
        <div class="rvm"><div class="rvz han">${esc(tr?l.traditional:l.simplified)}</div>
        <div class="rvp">${esc(showPy(l))}</div>
        <div class="rve">${esc(l.english)}${l.englishCheck&&!l.englishEdited?' <span class="badge chk">CHECK</span>':''}</div></div>
        <svg class="pen" width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M9.5 2l2.5 2.5L5 11.5 2 12l.5-3z" stroke-linejoin="round"/></svg></button>`).join('')}</div>
    ${RV.existing?`<button class="btn ghost danger" id="rvDel" style="margin-top:22px">Delete song</button>`:''}
  </div>`;
  const keep=()=>{sg.title=$('#rvTitle').value.trim()||sg.title; sg.englishTitle=$('#rvEn').value.trim(); sg.artist=$('#rvArt').value.trim()};
  $('#rvBack').onclick=()=>{ if(RV.existing){closeFlow();return} keep(); AD=AD||{title:sg.title,artist:sg.artist,text:'',src:null,file:null}; renderAdd() };
  $('#rvSave').onclick=async()=>{
    keep();
    if(RV.edit!=null&&!commitEdit()) return;
    // the title may have been retyped in either script
    try{ await needOpenCC();
      const tt=bothScripts(sg.title,CV.t2s(sg.title)!==sg.title?'traditional':'simplified');
      sg.title=tt.s; sg.titleTrad=tt.t;
      await needCedict().catch(()=>{}); sg.titlePinyin=linePinyin(segmentLine(tt.s,tt.t));
    }catch(e){}
    sg.lines.forEach((l,i)=>l.index=i);
    const at=SG.findIndex(x=>x.id===sg.id);
    if(at>=0) SG[at]=sg; else SG.push(sg);
    if(!saveSongs()) return;
    put(slot('songsig'),idxSig());
    closeFlow(); toast(RV.existing?'Saved':'Song added');
    if(LY&&LY.id===sg.id) renderLyrics(); if(cur==='songs') renderSongs();
  };
  const del=$('#rvDel'); if(del) del.onclick=()=>{
    if(!confirm(`Delete ${sg.title}?`)) return;
    SG=SG.filter(x=>x.id!==sg.id); saveSongs(); closeFlow(); closeLyrics(); toast('Deleted'); if(cur==='songs') renderSongs();
  };
  $$('.rvrow').forEach(b=>b.onclick=()=>{ if(RV.edit!=null&&!commitEdit()) return; keep(); RV.edit=+b.dataset.i; renderRev();
    const z=$('#reZ'); if(z){ z.focus(); z.scrollIntoView({block:'center'}) } });
  const dn=$('#reDone'); if(dn) dn.onclick=()=>{ keep(); if(commitEdit()){ RV.edit=null; renderRev() } };
  const rm=$('#reDel'); if(rm) rm.onclick=()=>{ keep(); sg.lines.splice(RV.edit,1); RV.edit=null; renderRev() };
}
function editRow(l,i){
  const tr=songScript()==='t';
  return `<div class="rvrow edit"><span class="rvn">${String(i+1).padStart(2,'0')}</span><div class="rvm">
    <label class="flab">Hanzi</label><input id="reZ" class="finp han" value="${esc(tr?l.traditional:l.simplified)}">
    <label class="flab">Pinyin <span>one syllable per character · ni3 hao3 works</span></label><input id="reP" class="finp" value="${esc(l.pinyin)}" autocapitalize="off" autocorrect="off" spellcheck="false">
    <label class="flab">English</label><input id="reE" class="finp" value="${esc(l.english)}">
    <div class="merr" id="reErr" hidden></div>
    <div class="mrow"><button class="btn ghost danger" id="reDel">Remove line</button><button class="btn" id="reDone">Done</button></div>
  </div></div>`;
}
// apply the open edit to the line; false (with a message) if the pinyin won't fit
function commitEdit(){
  const l=RV.song.lines[RV.edit]; if(!l) return true;
  const tr=songScript()==='t';
  const z=$('#reZ').value.trim(), p=numToMarks($('#reP').value.trim()).replace(/\s+/g,' '), e=$('#reE').value.trim();
  const err=t=>{const x=$('#reErr'); x.textContent=t; x.hidden=false; return false};
  if(!hasCJK(z)) return err('A line needs at least one Chinese character.');
  const oldZ=tr?l.traditional:l.simplified;
  if(z!==oldZ){
    if(!CV||!CED) return err('Still loading the dictionary — try again in a moment.');
    const {s,t}=bothScripts(z,tr?'traditional':'simplified');
    const fresh=buildLine(s,t,l.index);
    Object.assign(l,{simplified:s,traditional:t,tokens:fresh.tokens,pinyin:fresh.pinyin,pinyinEdited:false});
    if(!l.englishEdited&&e===l.english){ l.english=glossLine(l.tokens); l.englishCheck=true }
  } else if(p!==l.pinyin){
    // spread the corrected syllables back over the words
    const han=l.tokens.filter(t=>t.pinyin), need=han.reduce((a,t)=>a+[...t.simplified].length,0);
    const syl=splitPinyin(p.replace(/[,.?!:;"…，。？！：；]/g,' ')).filter(x=>/[a-zü]/i.test(stripTone(x)));
    if(syl.length!==need) return err(`That pinyin has ${syl.length} syllable${syl.length===1?'':'s'}; this line has ${need} characters.`);
    let k=0; han.forEach(t=>{const n=[...t.simplified].length; t.pinyin=syl.slice(k,k+n).join(' ').toLowerCase(); k+=n});
    l.pinyin=linePinyin(l.tokens); l.pinyinEdited=true;
  }
  if(e!==l.english){ l.english=e; l.englishEdited=true; l.englishCheck=false }
  return true;
}
