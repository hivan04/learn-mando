/* ── Hanzi · offline study app ──────────────────────────────── */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const DAY=864e5;
const el=(t,c,h)=>{const n=document.createElement(t);if(c)n.className=c;if(h!=null)n.innerHTML=h;return n};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ── state ─────────────────────────────────────────────────── */
const DEF={deck:'notes',hsk:1,pyIdx:'All',week:'all',kind:'vocab',rotate:3,tones:true,theme:'auto',
           newPerDay:8,reviewLimit:60,libMode:'chars'};
let S=load('hanzi.settings',DEF);
let P=load('hanzi.progress',{cards:{},log:{},streak:{n:0,last:null},seen:[]});
function load(k,d){try{return Object.assign(structuredClone(d),JSON.parse(localStorage.getItem(k)||'{}'))}catch(e){return structuredClone(d)}}
function saveS(){try{localStorage.setItem('hanzi.settings',JSON.stringify(S))}catch(e){}}
function saveP(){try{localStorage.setItem('hanzi.progress',JSON.stringify(P))}catch(e){}}

let D={notes:null,hsk:null,strokes:{}};
let CHARIDX=new Map(), WORDIDX=new Map();

/* ── pinyin / tones ────────────────────────────────────────── */
const TMAP={'āēīōūǖ':1,'áéíóúǘ':2,'ǎěǐǒǔǚ':3,'àèìòùǜ':4};
function toneOf(syl){
  for(const ch of syl) for(const k in TMAP) if(k.includes(ch)) return TMAP[k];
  return 5;
}
const INITIALS=['zh','ch','sh','b','p','m','f','d','t','n','l','g','k','h','j','q','x','r','z','c','s','y','w'];
const FINALS=['iang','iong','uang','ueng','ang','eng','ing','ong','uai','uan','ian','iao','iou','uei','er',
 'ai','ei','ao','ou','an','en','in','un','ia','ie','iu','ua','uo','ui','ue','üe','üa','ün','ün',
 'a','o','e','i','u','ü','v','n','m','r','ng'];
FINALS.sort((a,b)=>b.length-a.length);
function splitPinyin(p){
  if(/\s/.test(p.trim()))
    return p.trim().split(/\s+/).flatMap(chunk=>splitOne(chunk));
  return splitOne(p);
}
function splitOne(p){
  const bare=stripTone(p), out=[]; let i=0, raw=0;
  const base=p;
  while(i<bare.length){
    if(!/[a-zü]/.test(bare[i])){ i++; raw++; continue }
    let ini=INITIALS.find(x=>bare.startsWith(x,i))||'';
    let j=i+ini.length, fin='';
    for(const f of FINALS){ if(bare.startsWith(f,j)){ fin=f; break } }
    if(!fin){ if(!ini){ i++; raw++; continue } fin='' }
    let len=ini.length+fin.length;
    // don't swallow an 'n'/'ng' that starts the next syllable's initial+vowel
    const after=bare.slice(i+len);
    if(/^(g?)[aeiouü]/.test(after) && /n$|ng$/.test(fin)){
      const back=fin.endsWith('ng')?(/^g?[aeiouü]/.test(bare.slice(i+len-1))?1:0):0;
      if(fin.endsWith('ng') && /^[aeiouü]/.test(bare.slice(i+len))) len-=1;
      else if(fin.endsWith('n') && /^[aeiouü]/.test(bare.slice(i+len))) len-=1;
    }
    out.push(base.substr(raw,len)); raw+=len; i+=len;
  }
  return out.length?out:[p];
}
function colorPy(p){
  if(!p) return '';
  return p.trim().split(/\s+/).map(chunk=>
    splitOne(chunk).map(w=>`<span class="t${toneOf(w)}">${esc(w)}</span>`).join('')
  ).join(' ');
}
const stripTone=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

/* ── deterministic rotation ────────────────────────────────── */
function rotIndex(len,hours){
  const block=Math.floor(Date.now()/36e5/hours);
  // hash the block so consecutive blocks aren't adjacent items
  let h=block*2654435761%2147483647; h=(h^(h>>>13))>>>0;
  return ((h%len)+len)%len;
}
function nextRotation(hours){
  const ms=hours*36e5; return new Date(Math.ceil(Date.now()/ms)*ms);
}

/* ── card pool ─────────────────────────────────────────────── */
function pool(){
  if(S.deck==='hsk'){
    return D.hsk.words.filter(w=>w.lv<=S.hsk).map(w=>({id:'h:'+w.h,h:w.h,p:w.p,e:w.e,meta:'HSK '+w.lv}));
  }
  const out=[];
  for(const v of D.notes.vocab) out.push({id:'v:'+v.id,h:v.h,p:v.p,e:v.e,meta:v.l,w:v.w});
  for(const s of D.notes.sentences) out.push({id:'s:'+s.id,h:s.h,p:s.p,e:s.e,meta:s.l,w:s.w,long:1});
  return out;
}
function cotdPool(){
  return S.deck==='hsk'
    ? D.hsk.words.filter(w=>w.lv<=S.hsk).map(w=>({h:w.h,p:w.p,e:w.e}))
    : D.notes.vocab.map(v=>({h:v.h,p:v.p,e:v.e,w:v.w,l:v.l}));
}
function exampleFor(h){
  const hits=D.notes.sentences.filter(x=>x.h.includes(h)).sort((a,b)=>a.h.length-b.h.length);
  const s=hits[0]; if(!s) return null;
  return {zh:esc(s.h).replace(esc(h),`<span class="t1">${esc(h)}</span>`),p:s.p,e:s.e};
}

/* ── SRS (SM-2 lite) ───────────────────────────────────────── */
const IVL={again:0,hard:3,good:8,easy:21};
function card(id){return P.cards[id]||(P.cards[id]={n:0,ivl:0,due:0,ease:2.5,lapses:0})}
function grade(id,g){
  const c=card(id), now=Date.now();
  if(g==='again'){c.ivl=0;c.n=0;c.lapses++;c.ease=Math.max(1.3,c.ease-.2);c.due=now+6e4}
  else{
    c.n++;
    const mult={hard:1.2,good:2.5,easy:3.6}[g];
    c.ease=Math.min(3.2,Math.max(1.3,c.ease+({hard:-.15,good:0,easy:.12})[g]));
    c.ivl=c.n===1?IVL[g]:Math.round(Math.max(1,c.ivl)*mult*(c.ease/2.5));
    c.due=now+c.ivl*DAY;
  }
  c.seen=now;
  const k=dayKey(); P.log[k]=(P.log[k]||0)+1;
  bumpStreak();
  P.seen=[id,...P.seen.filter(x=>x!==id)].slice(0,24);
  saveP();
}
const dayKey=(d=new Date())=>d.toISOString().slice(0,10);
function bumpStreak(){
  const t=dayKey(), y=dayKey(new Date(Date.now()-DAY));
  if(P.streak.last===t) return;
  P.streak.n = P.streak.last===y ? P.streak.n+1 : 1;
  P.streak.last=t;
}
function dueCards(){
  const now=Date.now(), p=pool();
  const due=p.filter(c=>P.cards[c.id]&&P.cards[c.id].due<=now);
  const fresh=p.filter(c=>!P.cards[c.id]);
  return [...due.sort((a,b)=>P.cards[a.id].due-P.cards[b.id].due),
          ...fresh.slice(0,S.newPerDay)].slice(0,S.reviewLimit);
}
const learned=()=>Object.values(P.cards).filter(c=>c.n>0&&c.ivl>=3).length;
function accuracy(){
  const v=Object.values(P.cards); if(!v.length) return null;
  const r=v.reduce((a,c)=>a+c.n,0), l=v.reduce((a,c)=>a+c.lapses,0);
  return r+l?Math.round(r/(r+l)*100):null;
}

/* ── strokes (lazy, 4 shards) ──────────────────────────────── */
const shardFor=ch=>{ // shards were split on sorted key order; build a map on first load
  return null;
};
let strokeLoaded=false, strokePending=null;
async function loadStrokes(){
  if(strokeLoaded) return;
  if(strokePending) return strokePending;
  strokePending=(async()=>{
    const parts=await Promise.all([0,1,2,3].map(i=>
      fetch(`data/strokes-${i}.json`).then(r=>r.ok?r.json():{}).catch(()=>({}))));
    for(const p of parts) Object.assign(D.strokes,p);
    strokeLoaded=true;
  })();
  return strokePending;
}

/* ── stroke animation (self-contained, no deps) ────────────── */
function drawChar(host,ch,{animate=true,radical=true}={}){
  const d=D.strokes[ch]; host.innerHTML='';
  const box=el('div','wbox'); host.appendChild(box);
  const NS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox','0 0 1024 1024');
  svg.setAttribute('width','104'); svg.setAttribute('height','104');
  box.appendChild(svg);
  if(!d){ box.innerHTML=`<div style="display:flex;height:100%;align-items:center;justify-content:center;font:500 58px/1 var(--han)">${esc(ch)}</div>`; return }
  const g=document.createElementNS(NS,'g');
  g.setAttribute('transform','translate(0,900) scale(1,-1)');
  svg.appendChild(g);
  const rad=new Set(radical?(d.r||[]):[]);
  const paths=d.s.map((p,i)=>{
    const el2=document.createElementNS(NS,'path');
    el2.setAttribute('d',p);
    el2.setAttribute('fill',rad.has(i)?'var(--red)':'var(--ink)');
    el2.style.opacity=animate?0:1;
    g.appendChild(el2); return el2;
  });
  if(animate) paths.forEach((p,i)=>setTimeout(()=>{
    p.style.transition='opacity .16s'; p.style.opacity=1;
  },i*170));
  return ()=>drawChar(host,ch,{animate:true,radical});
}

/* ── speech ────────────────────────────────────────────────── */
let voices=[];
function pickVoice(){
  voices=speechSynthesis.getVoices();
  return voices.find(v=>/^zh[-_]CN/i.test(v.lang))||voices.find(v=>/^zh/i.test(v.lang));
}
speechSynthesis&&(speechSynthesis.onvoiceschanged=pickVoice);
function say(text,btn){
  if(!window.speechSynthesis) return toast('Speech not available');
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  const v=pickVoice(); if(v) u.voice=v;
  u.lang='zh-CN'; u.rate=.82;
  if(btn){btn.classList.add('busy'); u.onend=u.onerror=()=>btn.classList.remove('busy')}
  speechSynthesis.speak(u);
}

/* ── toast ─────────────────────────────────────────────────── */
let tt;
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');
  clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),1700)}

/* ── icons ─────────────────────────────────────────────────── */
const I={
  today:'<circle cx="11" cy="11" r="8"/><path d="M11 6.5V11l3 2" stroke-linecap="round"/>',
  library:'<rect x="3.5" y="4" width="15" height="14" rx="2"/><path d="M11 4v14"/>',
  review:'<rect x="3.5" y="5.5" width="15" height="11" rx="2.5"/><path d="M7.5 11h7" stroke-linecap="round"/>',
  progress:'<rect x="4" y="12" width="3.4" height="6" rx="1"/><rect x="9.3" y="8" width="3.4" height="10" rx="1"/><rect x="14.6" y="4.5" width="3.4" height="13.5" rx="1"/>',
  settings:'<circle cx="11" cy="11" r="3"/><circle cx="11" cy="11" r="7.5" stroke-dasharray="3 3"/>',
  speak:'<path d="M3 7h3.5L11 3v13L6.5 12H3V7z" fill="currentColor" stroke="none"/><path d="M14 6a5 5 0 010 7" stroke-linecap="round"/>',
  star:'<path d="M9 1.6l2.1 4.4 4.8.7-3.5 3.4.8 4.8L9 12.6 4.8 14.9l.8-4.8L2.1 6.7l4.8-.7L9 1.6z" stroke-linejoin="round"/>',
  replay:'<path d="M3 9a6 6 0 106-6" stroke-linecap="round"/><path d="M3 3v3.2h3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  back:'<path d="M9 2L2 9l7 7" stroke-linecap="round" stroke-linejoin="round"/>',
  close:'<path d="M1.5 1.5l12 12M13.5 1.5l-12 12" stroke-linecap="round"/>',
  search:'<circle cx="6.5" cy="6.5" r="5"/><path d="M10.5 10.5L14 14" stroke-linecap="round"/>',
  arrow:'<path d="M1 5h9M6.5 1L10.5 5 6.5 9" stroke-linecap="round" stroke-linejoin="round"/>'
};
const svg=(k,s=18,st='currentColor')=>`<svg width="${s}" height="${s}" viewBox="0 0 ${k==='back'?11:k==='close'?15:k==='arrow'?12:k==='search'?15:k==='star'||k==='speak'?18:22} ${k==='back'?18:k==='close'?15:k==='arrow'?10:k==='search'?15:k==='star'||k==='speak'?18:22}" fill="none" stroke="${st}" stroke-width="1.6">${I[k]}</svg>`;

/* ── TODAY ─────────────────────────────────────────────────── */
function renderToday(){
  const s=$('#today'); const p=cotdPool();
  if(!p.length){s.innerHTML='<div class="empty">No cards in this deck.</div>';return}
  const w=p[rotIndex(p.length,S.rotate)];
  const ex=exampleFor(w.h);
  const due=dueCards().length;
  const nxt=nextRotation(S.rotate);
  const d=new Date();
  const dayName=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'});
  s.innerHTML=`
  <div class="topbar">
    <div>
      <div class="eyebrow" style="margin-bottom:8px">${esc(dayName)}</div>
      <div class="h1">Today</div>
    </div>
    <div class="streak"><i></i><b>${P.streak.n}</b><em>day${P.streak.n===1?'':'s'}</em></div>
  </div>
  <div class="card cotd">
    <div class="head">
      <span class="eyebrow" style="color:var(--red)">Character of the day</span>
      <div style="display:flex;gap:16px;align-items:center">
        <button id="cotdSay" aria-label="Pronounce">${svg('speak',17,'var(--ink4)')}</button>
      </div>
    </div>
    <div class="glyph han" id="cotdGlyph">${esc(w.h)}</div>
    <div class="py">${colorPy(w.p)}</div>
    <div class="en">${esc(w.e)}</div>
    ${ex?`<div class="ex">
      <div class="eyebrow" style="margin-bottom:9px">Example</div>
      <div class="zh">${ex.zh}</div>
      <div class="pp">${esc(ex.p)}</div>
      <div class="ee">${esc(ex.e)}</div></div>`:''}
    <div style="margin-top:16px;text-align:center" class="eyebrow">
      rotates ${nxt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
    </div>
  </div>
  <div class="duo">
    <div class="tile solid" id="goReview">
      <div class="num">${due}</div>
      <div class="lab">card${due===1?'':'s'} due for review</div>
      <div class="go">Start review ${svg('arrow',12,'currentColor')}</div>
    </div>
    <div class="tile out">
      <div class="num">${learned()}</div>
      <div class="lab">characters learned</div>
      <div class="go" style="color:var(--ink4)">${S.deck==='hsk'?'HSK 1–'+S.hsk:'My notes'}</div>
    </div>
  </div>
  ${P.seen.length?`<div class="eyebrow" style="margin:18px 0 10px 2px">Recently seen</div>
  <div class="rowlist" id="recent"></div>`:''}`;
  $('#cotdGlyph').onclick=()=>openChar(w.h);
  $('#cotdSay').onclick=e=>say(w.h,e.currentTarget.closest('button'));
  $('#goReview').onclick=()=>go('review');
  const r=$('#recent');
  if(r){
    const all=pool();
    P.seen.slice(0,12).forEach(id=>{
      const c=all.find(x=>x.id===id); if(!c)return;
      const n=el('button','minicard',`<div class="g han">${esc(c.h.slice(0,2))}</div><div class="p">${esc((c.p||'').split(' ')[0])}</div>`);
      n.onclick=()=>openChar(c.h,c); r.appendChild(n);
    });
  }
}

/* ── LIBRARY ───────────────────────────────────────────────── */
let libQuery='';
function renderLibrary(){
  const s=$('#library');
  const isH=S.deck==='hsk';
  s.innerHTML=`
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px">
    <div class="h1">Library</div>
    <div style="font:400 12px/1 var(--sans);color:var(--ink4)" id="libCount"></div>
  </div>
  <div class="seg" id="deckSeg">
    <button data-d="notes" class="${isH?'':'on'}">My notes</button>
    <button data-d="hsk" class="${isH?'on':''}">HSK</button>
  </div>
  <div class="search">
    ${svg('search',15,'var(--ink5)')}
    <input id="libSearch" placeholder="Search hanzi, pinyin or English" value="${esc(libQuery)}" autocomplete="off" autocorrect="off" spellcheck="false">
    <span class="n" id="libN"></span>
  </div>
  <div class="chips" id="libChips"></div>
  <div id="pyIndexWrap"></div>
  <div class="seg" id="libMode" style="margin-top:12px">
    ${isH?`<button data-m="chars" class="${S.libMode==='chars'?'on':''}">Characters</button>
          <button data-m="words" class="${S.libMode==='words'?'on':''}">Words</button>`
         :`<button data-m="vocab" class="${S.kind==='vocab'?'on':''}">Vocab</button>
           <button data-m="sentences" class="${S.kind==='sentences'?'on':''}">Sentences</button>
           <button data-m="grammar" class="${S.kind==='grammar'?'on':''}">Grammar</button>`}
  </div>
  <div id="libBody"></div>`;

  $$('#deckSeg button').forEach(b=>b.onclick=()=>{S.deck=b.dataset.d;saveS();libQuery='';renderLibrary()});
  $$('#libMode button').forEach(b=>b.onclick=()=>{
    if(isH)S.libMode=b.dataset.m; else S.kind=b.dataset.m; saveS(); renderLibrary();
  });
  const inp=$('#libSearch');
  inp.oninput=()=>{libQuery=inp.value;fillLib()};

  const chips=$('#libChips');
  if(isH){
    [1,2,3,4,5,6].forEach(l=>{
      const c=el('button','chip'+(S.hsk===l?' on':''),'HSK '+l);
      c.onclick=()=>{S.hsk=l;saveS();renderLibrary()}; chips.appendChild(c);
    });
  }else{
    [['all','All'],[1,'Week 1'],[2,'Week 2'],[3,'Week 3'],[4,'Week 4'],[5,'Week 5'],[6,'Week 6'],[0,'Extras']]
      .forEach(([v,lab])=>{
        const c=el('button','chip'+(String(S.week)===String(v)?' on':''),lab);
        c.onclick=()=>{S.week=v;saveS();renderLibrary()}; chips.appendChild(c);
      });
  }
  const pw=$('#pyIndexWrap');
  if(isH && S.libMode==='chars'){
    const letters=['All','A','B','C','CH','D','E','F','G','H','J','K','L','M','N','O','P','Q','R','S','SH','T','W','X','Y','Z','ZH'];
    pw.innerHTML='<div class="card" style="padding:9px 10px;margin-top:10px">'+
      '<div class="eyebrow" style="margin:2px 0 8px 2px">Pinyin index</div>'+
      '<div class="chips" id="pyIdx"></div></div>';
    letters.forEach(L=>{
      const b=el('button','chip'+((S.pyIdx||'All')===L?' on':''),L);
      b.style.padding='7px 11px';
      b.onclick=()=>{S.pyIdx=L;saveS();renderLibrary()};
      $('#pyIdx').appendChild(b);
    });
  } else pw.innerHTML='';
  fillLib();
}
function libItems(){
  const q=stripTone(libQuery.trim());
  const match=(o)=>!q||o.h.includes(libQuery.trim())||stripTone(o.p||'').replace(/\s/g,'').includes(q.replace(/\s/g,''))||(o.e||'').toLowerCase().includes(q);
  if(S.deck==='hsk'){
    if(S.libMode==='chars'){
      const L=S.pyIdx&&S.pyIdx!=='All'?S.pyIdx.toLowerCase():null;
      const two=['zh','ch','sh'];
      return D.hsk.chars.filter(c=>c.lv===S.hsk)
        .filter(c=>{if(!L)return true;const b=stripTone(c.p||'');
          return two.includes(L)?b.startsWith(L)
            :(b.startsWith(L)&&!two.some(t=>b.startsWith(t)&&t[0]===L))})
        .filter(c=>!q||c.c.includes(libQuery.trim())||stripTone(c.p||'').includes(q)||(c.e||'').toLowerCase().includes(q))
        .map(c=>({kind:'char',h:c.c,p:c.p,e:c.e,n:c.n,lv:c.lv}));
    }
    return D.hsk.words.filter(w=>w.lv===S.hsk).filter(match)
      .map(w=>({kind:'word',h:w.h,p:w.p,e:w.e,tag:'HSK '+w.lv}));
  }
  const wk=S.week;
  const inWeek=o=>wk==='all'||String(o.w)===String(wk);
  if(S.kind==='grammar'){
    return D.notes.grammar.filter(g=>wk==='all'||String(g.w)===String(wk))
      .filter(g=>!q||g.t.toLowerCase().includes(q)||g.s.toLowerCase().includes(q))
      .map(g=>({kind:'gram',...g}));
  }
  const src=S.kind==='vocab'?D.notes.vocab:D.notes.sentences;
  return src.filter(inWeek).filter(match)
    .map(o=>({kind:S.kind==='vocab'?'word':'sent',h:o.h,p:o.p,e:o.e,tag:o.w?'W'+o.w:'Extra',meta:o.l}));
}
function fillLib(){
  const items=libItems(), body=$('#libBody');
  $('#libN').textContent=items.length?items.length:'';
  $('#libCount').textContent=S.deck==='hsk'
    ? `HSK ${S.hsk} · ${items.length} ${S.libMode}`
    : `${items.length} ${S.kind}`;
  body.innerHTML='';
  if(!items.length){body.appendChild(el('div','empty','Nothing matches that search.'));return}
  if(items[0].kind==='char'){
    const g=el('div','grid');
    items.forEach(it=>{
      const known=P.cards['h:'+it.h]&&P.cards['h:'+it.h].n>0;
      const c=el('button','gcell'+(known?' known':''),
        `<div class="g han">${esc(it.h)}</div><div class="p">${esc(it.p||'')}</div>`);
      c.onclick=()=>openChar(it.h); g.appendChild(c);
    });
    body.appendChild(g); return;
  }
  if(items[0].kind==='gram'){
    items.forEach(it=>{
      const c=el('div','card',`<div style="padding:16px 16px 14px">
        <div style="font:400 16px/1.4 var(--sans);color:var(--ink)">${esc(it.t)}</div>
        <div style="margin-top:8px;font:400 13.5px/1.6 var(--sans);color:var(--ink3)">${esc(it.s)}</div>
        ${(it.ex||[]).map(x=>`<div style="margin-top:12px">
          <div class="zh" style="font:400 18px/1.55 var(--han)">${esc(x.h)}</div>
          <div class="pp">${esc(x.p)}</div><div class="ee">${esc(x.e)}</div></div>`).join('')}
      </div>`);
      c.style.marginBottom='10px'; body.appendChild(c);
    });
    return;
  }
  items.forEach(it=>{
    const long=it.kind==='sent';
    const r=el('button','wrow');
    r.style.width='100%'; r.style.textAlign='left';
    r.innerHTML=long
      ? `<div class="m"><div style="font:400 19px/1.6 var(--han);color:var(--ink)">${esc(it.h)}</div>
         <div class="pp">${esc(it.p)}</div><div class="ee">${esc(it.e)}</div></div>
         <span class="tag">${esc(it.tag||'')}</span>`
      : `<div class="g han">${esc(it.h)}</div>
         <div class="m"><div class="p">${colorPy(it.p)}</div><div class="e">${esc(it.e)}</div></div>
         <span class="tag">${esc(it.tag||'')}</span>`;
    r.onclick=()=>openChar(it.h,it); body.appendChild(r);
  });
}

/* ── CHARACTER SHEET ───────────────────────────────────────── */
let sheetChar=null;
async function openChar(h,ctx){
  sheetChar=h;
  const sheet=$('#sheet'); sheet.classList.add('on');
  const single=[...h].filter(c=>c>='一'&&c<='鿿');
  const info=D.hsk.chars.find(c=>c.c===single[0])||{};
  const word=D.hsk.words.find(w=>w.h===h);
  const py=(ctx&&ctx.p)||(word&&word.p)||info.p||'';
  const en=(ctx&&ctx.e)||(word&&word.e)||info.e||'';
  const tone=toneOf((py||'').split(' ')[0]||'');
  const one=single.length===1&&[...h].length===1;
  const inNotes=D.notes.vocab.some(v=>v.h===h)||D.notes.sentences.some(x=>x.h===h)||(one&&info.mine);
  const appears=D.hsk.words.filter(w=>w.h!==h&&w.h.includes(single[0])).slice(0,8);
  const mine=D.notes.vocab.filter(v=>v.h!==h&&v.h.includes(single[0])).slice(0,6);
  const exs=D.notes.sentences.filter(s=>s.h.includes(single[0])).slice(0,4);

  $('#sheet .panel').innerHTML=`
  <div class="sheetbar">
    <button id="sheetBack">${svg('back',17,'var(--ink)')}</button>
    <span class="t han">${esc(h)}</span>
    <button id="sheetAdd">${svg('star',18,'var(--ink4)')}</button>
  </div>
  <div class="sheetbody">
    <div class="hero">
      <div class="big han">${esc(h)}</div>
      <div class="py">${colorPy(py)}</div>
      <div class="metas">
        ${word?`<span class="tag">HSK ${word.lv}</span>`
          :(one&&info.lv?`<span class="tag">HSK ${info.lv}</span>`:'')}
        ${one&&info.n?`<span class="tag">${info.n} STROKES</span>`:''}
        ${one&&py?`<span class="tag">TONE ${tone===5?'NEUTRAL':tone}</span>`:''}
        ${inNotes?`<span class="tag" style="color:var(--sage)">IN MY NOTES</span>`:''}
      </div>
      <div class="acts">
        <button id="actSay">${svg('speak',20)}</button>
        <button id="actReplay">${svg('replay',18)}</button>
      </div>
    </div>
    <div class="sect">
      <h4>Meaning</h4>
      <div class="meaning">${esc(en)||'<span style="color:var(--ink4)">No definition on file</span>'}</div>
      ${en?`<div class="pills">${en.split(/[;·]/).map(x=>x.trim()).filter(Boolean).slice(0,5)
        .map(x=>`<span class="pill">${esc(x)}</span>`).join('')}</div>`:''}

      ${single.length?`<h4 class='sp'>Stroke order${info.n?` · radical in vermilion`:''}</h4>
      <div id="writer"></div>`:''}

      ${exs.length?`<h4 class='sp'>From your notes</h4><div class="exlist">${exs.map(s=>`<div>
        <div class="zh">${esc(s.h).replace(esc(single[0]),`<span class="t1">${esc(single[0])}</span>`)}</div>
        <div class="pp">${esc(s.p)}</div><div class="ee">${esc(s.e)}</div></div>`).join('')}</div>`:''}

      ${mine.length?`<h4 class='sp'>Related in my notes</h4><div class="pills">${mine.map(v=>
        `<button class="pill jump" data-h="${esc(v.h)}"><span class="han">${esc(v.h)}</span> · ${esc(v.p)}</button>`).join('')}</div>`:''}

      ${appears.length?`<h4 class='sp'>Also appears in</h4><div class="pills">${appears.map(w=>
        `<button class="pill jump" data-h="${esc(w.h)}"><span class="han">${esc(w.h)}</span> · ${esc(w.p)}</button>`).join('')}</div>`:''}
      <div style="height:8px"></div>
    </div>
  </div>
  <div class="cta"><button class="btn" id="sheetStudy">Study this now</button></div>`;

  $('#sheetBack').onclick=closeSheet;
  $('#sheet .scrim').onclick=closeSheet;
  $('#actSay').onclick=e=>say(h,e.currentTarget);
  $('#sheetAdd').onclick=()=>{card((S.deck==='hsk'?'h:':'v:')+h);saveP();toast('Added to review deck')};
  $('#sheetStudy').onclick=()=>{closeSheet();go('review')};
  $$('.jump',$('#sheet')).forEach(b=>b.onclick=()=>openChar(b.dataset.h));
  if(single.length){
    await loadStrokes();
    const host=$('#writer'); if(!host) return;
    host.innerHTML='';
    const redraw=[];
    single.slice(0,4).forEach(c=>{
      const w=el('div'); host.appendChild(w);
      redraw.push(drawChar(w,c));
    });
    const rp=$('#actReplay'); if(rp) rp.onclick=()=>{host.innerHTML='';
      single.slice(0,4).forEach(c=>{const w=el('div');host.appendChild(w);drawChar(w,c)})};
  }
}
function closeSheet(){$('#sheet').classList.remove('on');sheetChar=null;speechSynthesis&&speechSynthesis.cancel()}

/* ── REVIEW ────────────────────────────────────────────────── */
let R={queue:[],i:0,shown:false,ok:0,miss:0,mode:'h2e'};
const MODES={h2e:'Hanzi → meaning',e2h:'Meaning → hanzi',p2h:'Pinyin → hanzi'};
function startReview(){
  R.queue=dueCards(); R.i=0; R.ok=0; R.miss=0; R.shown=false;
  renderReview();
}
function renderReview(){
  const s=$('#review');
  if(!R.queue.length){
    s.innerHTML=`<div style="padding:calc(var(--safeT) + 40px) 18px 18px">
      <div class="h1">Review</div></div>
      <div class="empty" style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:14px">
        <div style="font:500 44px/1 var(--han);color:var(--sage)">✓</div>
        <div>Nothing due right now.<br>New cards unlock as you study.</div>
        <div style="margin-top:8px"><button class="btn ghost" id="revAny" style="width:auto;padding:12px 22px;margin:0 auto">Study ahead anyway</button></div>
      </div>`;
    const b=$('#revAny'); if(b) b.onclick=()=>{
      R.queue=pool().sort(()=>Math.random()-.5).slice(0,20);R.i=0;R.ok=0;R.miss=0;R.shown=false;renderReview()};
    return;
  }
  if(R.i>=R.queue.length){
    s.innerHTML=`<div style="padding:calc(var(--safeT) + 40px) 18px 18px"><div class="h1">Done</div></div>
      <div class="empty" style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px">
        <div style="font:400 46px/1 var(--serif);color:var(--ink)">${R.ok}/${R.ok+R.miss}</div>
        <div>Session complete · streak ${P.streak.n} day${P.streak.n===1?'':'s'}</div>
        <div style="margin-top:6px;display:flex;gap:10px;justify-content:center">
          <button class="btn ghost" id="revAgain" style="width:auto;padding:12px 20px">Another round</button>
          <button class="btn" id="revHome" style="width:auto;padding:12px 20px">Back to today</button>
        </div></div>`;
    $('#revAgain').onclick=startReview; $('#revHome').onclick=()=>go('today');
    return;
  }
  const c=R.queue[R.i];
  const pct=Math.round(R.i/R.queue.length*100);
  const front = R.mode==='h2e' ? `<div class="prompt han${c.long?' small':''}">${esc(c.h)}</div>`
    : R.mode==='p2h' ? `<div class="prompt small">${colorPy(c.p)}</div>`
    : `<div class="prompt small">${esc(c.e)}</div>`;
  const back = R.mode==='h2e'
    ? `<div class="rpy">${colorPy(c.p)}</div><div class="ren">${esc(c.e)}</div>`
    : `<div class="rpy han" style="font-size:52px;line-height:1.2">${esc(c.h)}</div>
       <div class="ren">${R.mode==='p2h'?esc(c.e):colorPy(c.p)}</div>`;
  s.innerHTML=`
  <div class="rtop">
    <div class="rbar">
      <button id="revQuit">${svg('close',15,'var(--ink)')}</button>
      <div class="track"><i style="width:${pct}%"></i></div>
      <span class="mono" style="font-size:12px;color:var(--ink3)">${R.i+1}/${R.queue.length}</span>
    </div>
    <div class="rstats">
      <span style="color:var(--sage)">✓ ${R.ok} known</span>
      <span style="color:var(--red)">✕ ${R.miss} missed</span>
      <span style="color:var(--ink5)">${R.queue.length-R.i} left</span>
    </div>
  </div>
  <div class="rmid">
    <div class="qcard" id="qcard">
      <div class="eyebrow">${MODES[R.mode]}</div>
      <div style="margin-top:22px">${front}</div>
      ${R.shown?`<div class="reveal">${back}
        <div style="margin-top:14px"><button id="revSay">${svg('speak',20,'var(--ink4)')}</button></div></div>`:''}
    </div>
    ${R.shown?'':'<div class="tapme">tap the card to reveal</div>'}
  </div>
  <div class="rbot">
    ${R.shown?`<div class="grades">
      <button class="again" data-g="again"><div class="g1">Again</div><div class="g2">1m</div></button>
      <button data-g="hard"><div class="g1">Hard</div><div class="g2">${IVL.hard}d</div></button>
      <button class="good" data-g="good"><div class="g1">Good</div><div class="g2">${IVL.good}d</div></button>
      <button data-g="easy"><div class="g1">Easy</div><div class="g2">${IVL.easy}d</div></button>
    </div>`:`<button class="btn" id="revShow">Show answer</button>`}
  </div>`;
  $('#revQuit').onclick=()=>go('today');
  const reveal=()=>{R.shown=true;renderReview();if(R.mode==='h2e')say(c.h)};
  $('#qcard').onclick=()=>{if(!R.shown)reveal()};
  const sb=$('#revShow'); if(sb) sb.onclick=reveal;
  const sy=$('#revSay'); if(sy) sy.onclick=e=>{e.stopPropagation();say(c.h,e.currentTarget)};
  $$('.grades button').forEach(b=>b.onclick=()=>{
    const g=b.dataset.g; grade(c.id,g);
    g==='again'?R.miss++:R.ok++;
    R.i++; R.shown=false; renderReview();
  });
}

/* ── PROGRESS ──────────────────────────────────────────────── */
function renderProgress(){
  const s=$('#progress');
  const days=[...Array(7)].map((_,i)=>{
    const d=new Date(Date.now()-(6-i)*DAY);
    return {k:dayKey(d),n:P.log[dayKey(d)]||0,l:'MTWTFSS'[(d.getDay()+6)%7]};
  });
  const max=Math.max(1,...days.map(d=>d.n));
  const acc=accuracy();
  const hskCov=[1,2,3,4,5,6].map(l=>{
    const tot=D.hsk.words.filter(w=>w.lv===l).length;
    const got=D.hsk.words.filter(w=>w.lv===l&&P.cards['h:'+w.h]&&P.cards['h:'+w.h].n>0).length;
    return {l,tot,got};
  });
  const noteTot=D.notes.vocab.length+D.notes.sentences.length;
  const noteGot=[...D.notes.vocab.map(v=>'v:'+v.id),...D.notes.sentences.map(x=>'s:'+x.id)]
    .filter(id=>P.cards[id]&&P.cards[id].n>0).length;
  const hardest=Object.entries(P.cards).filter(([,c])=>c.lapses>0)
    .sort((a,b)=>b[1].lapses-a[1].lapses).slice(0,6);
  const all=pool();
  s.innerHTML=`
  <div class="h1" style="margin-bottom:20px">Progress</div>
  <div class="stats3">
    <div class="tile solid"><div class="num">${P.streak.n}</div><div class="lab">day streak</div></div>
    <div class="tile out"><div class="num">${learned()}</div><div class="lab">cards learned</div></div>
    <div class="tile out"><div class="num">${acc==null?'—':acc+'<span style="font-size:18px">%</span>'}</div><div class="lab">recall accuracy</div></div>
  </div>
  <div class="card" style="padding:18px 16px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px">
      <span class="eyebrow">Cards reviewed</span>
      <span style="font:400 11px/1 var(--sans);color:var(--ink4)">last 7 days</span>
    </div>
    <div class="bars">${days.map((d,i)=>`<div class="col${i===6?' today':''}">
      <div class="b" style="height:${Math.round(d.n/max*100)}%"></div>
      <span class="lbl">${d.l}</span></div>`).join('')}</div>
  </div>
  <div class="card" style="padding:18px 16px;margin-bottom:14px">
    <div class="eyebrow" style="margin-bottom:16px">Coverage</div>
    <div class="cov">
      <div><div class="l"><span>My notes</span><span style="color:var(--ink4)">${noteGot} / ${noteTot}</span></div>
        <div class="t"><i style="width:${Math.round(noteGot/noteTot*100)}%"></i></div></div>
      ${hskCov.map(c=>`<div><div class="l"><span>HSK ${c.l}</span>
        <span style="color:var(--ink4)">${c.got} / ${c.tot}</span></div>
        <div class="t"><i style="width:${Math.round(c.got/c.tot*100)}%;background:${c.got===c.tot?'var(--sage)':'var(--red)'}"></i></div></div>`).join('')}
    </div>
  </div>
  ${hardest.length?`<div class="eyebrow" style="margin:18px 0 10px 2px">Hardest cards</div>
  <div class="card" style="overflow:hidden">${hardest.map(([id,c])=>{
    const o=all.find(x=>x.id===id)||{h:id.slice(2),p:'',e:''};
    return `<button class="row jump2" data-h="${esc(o.h)}" style="width:100%;text-align:left">
      <span class="han" style="font-size:22px;min-width:44px">${esc(o.h.slice(0,3))}</span>
      <span class="k" style="font-size:13px;color:var(--ink3)">${esc((o.e||'').slice(0,42))}</span>
      <span class="tag">${c.lapses}✕</span></button>`}).join('')}</div>`:''}
  <div style="height:20px"></div>`;
  $$('.jump2').forEach(b=>b.onclick=()=>openChar(b.dataset.h));
}

/* ── SETTINGS ──────────────────────────────────────────────── */
function renderSettings(){
  const s=$('#settings');
  const sel=(id,opts,val)=>`<select id="${id}">${opts.map(([v,l])=>
    `<option value="${v}"${String(v)===String(val)?' selected':''}>${l}</option>`).join('')}</select>`;
  s.innerHTML=`
  <div class="h1" style="margin-bottom:20px">Settings</div>
  <div class="eyebrow" style="margin:0 0 9px 2px">Study</div>
  <div class="group">
    <div class="row"><span class="k">Deck</span>
      ${sel('setDeck',[['notes','My notes'],['hsk','HSK']],S.deck)}</div>
    <div class="row"><span class="k">HSK level</span>
      ${sel('setHsk',[1,2,3,4,5,6].map(l=>[l,'HSK 1–'+l]),S.hsk)}</div>
    <div class="row"><span class="k">New cards per day</span>
      ${sel('setNew',[3,5,8,12,20,30].map(n=>[n,n]),S.newPerDay)}</div>
    <div class="row"><span class="k">Review limit</span>
      ${sel('setLimit',[20,40,60,100,200].map(n=>[n,n+' / day']),S.reviewLimit)}</div>
    <div class="row"><span class="k">Review direction</span>
      ${sel('setMode',Object.entries(MODES),R.mode)}</div>
  </div>
  <div class="eyebrow" style="margin:0 0 9px 2px">Character of the day</div>
  <div class="group">
    <div class="row"><span class="k">Rotate every</span>
      ${sel('setRot',[1,2,3,4,6,8,12,24].map(h=>[h,h+' hour'+(h===1?'':'s')]),S.rotate)}</div>
  </div>
  <div class="eyebrow" style="margin:0 0 9px 2px">Appearance</div>
  <div class="group">
    <div class="row"><span class="k">Theme</span>
      ${sel('setTheme',[['auto','Match system'],['light','Light'],['dark','Dark']],S.theme)}</div>
    <div class="row"><span class="k">Tone colours</span>
      <div class="sw${S.tones?' on':''}" id="setTones"><i></i></div></div>
  </div>
  <div class="eyebrow" style="margin:0 0 9px 2px">Data</div>
  <div class="group">
    <div class="row"><span class="k">Export progress</span><span class="v">JSON</span></div>
    <div class="row" id="setImport"><span class="k">Import progress</span><span class="v">JSON</span></div>
    <div class="row" id="setReset"><span class="k danger">Reset all progress</span></div>
  </div>
  <div class="foot">
    Hanzi · ${D.notes.vocab.length+D.notes.sentences.length+D.notes.grammar.length} cards from your notes
    · ${D.hsk.words.length} HSK words · ${D.hsk.chars.length} characters<br>
    Offline — nothing leaves this device.
  </div>`;
  const on=(id,fn)=>{const e=$('#'+id);if(e)e.onchange=fn};
  on('setDeck',e=>{S.deck=e.target.value;saveS();renderAll()});
  on('setHsk',e=>{S.hsk=+e.target.value;saveS();renderAll()});
  on('setNew',e=>{S.newPerDay=+e.target.value;saveS()});
  on('setLimit',e=>{S.reviewLimit=+e.target.value;saveS()});
  on('setMode',e=>{R.mode=e.target.value});
  on('setRot',e=>{S.rotate=+e.target.value;saveS();renderToday()});
  on('setTheme',e=>{S.theme=e.target.value;saveS();applyTheme()});
  $('#setTones').onclick=()=>{S.tones=!S.tones;saveS();applyTheme();renderSettings()};
  $$('.row').forEach(r=>{if(r.textContent.includes('Export'))r.onclick=exportP});
  $('#setImport').onclick=importP;
  $('#setReset').onclick=()=>{
    if(confirm('Erase all progress, streaks and review history? This cannot be undone.')){
      P={cards:{},log:{},streak:{n:0,last:null},seen:[]};saveP();renderAll();toast('Progress reset')}};
}
function exportP(){
  const blob=new Blob([JSON.stringify({settings:S,progress:P,exported:new Date().toISOString()},null,1)],
    {type:'application/json'});
  const a=el('a');a.href=URL.createObjectURL(blob);
  a.download='hanzi-progress-'+dayKey()+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000); toast('Exported');
}
function importP(){
  const i=el('input');i.type='file';i.accept='.json,application/json';
  i.onchange=()=>{const f=i.files[0];if(!f)return;const r=new FileReader();
    r.onload=()=>{try{const d=JSON.parse(r.result);
      if(d.progress)P=Object.assign({cards:{},log:{},streak:{n:0,last:null},seen:[]},d.progress);
      if(d.settings)S=Object.assign(structuredClone(DEF),d.settings);
      saveP();saveS();applyTheme();renderAll();toast('Progress restored');
    }catch(e){toast('Could not read that file')}};
    r.readAsText(f)};
  i.click();
}

/* ── nav / boot ────────────────────────────────────────────── */
const TABS=['today','library','review','progress','settings'];
let cur='today';
function go(t){
  cur=t;
  TABS.forEach(x=>$('#'+x).classList.toggle('on',x===t));
  $$('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  if(t==='today')renderToday();
  if(t==='library')renderLibrary();
  if(t==='review')startReview();
  if(t==='progress')renderProgress();
  if(t==='settings')renderSettings();
  $('#'+t).scrollTop=0;
}
function renderAll(){ go(cur) }
function applyTheme(){
  const r=document.documentElement;
  r.dataset.theme = S.theme==='auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : S.theme;
  r.dataset.tones = S.tones?'on':'off';
  const m=$('meta[name="theme-color"]');
  if(m) m.content=r.dataset.theme==='dark'?'#14120F':'#F6F1E6';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(S.theme==='auto')applyTheme()});

async function boot(){
  applyTheme();
  $('#tabs').innerHTML=TABS.map(t=>
    `<button data-t="${t}"${t===cur?' class="on"':''}>${svg(t,22)}<span>${t[0].toUpperCase()+t.slice(1)}</span></button>`).join('');
  $$('#tabs button').forEach(b=>b.onclick=()=>go(b.dataset.t));
  try{
    const [n,h]=await Promise.all([
      fetch('data/notes.json').then(r=>r.json()),
      fetch('data/hsk.json').then(r=>r.json())]);
    D.notes=n; D.hsk=h;
  }catch(e){
    $('#screens').innerHTML='<div class="empty">Could not load the dictionary data.<br>Reopen the app while online once.</div>';
    return;
  }
  D.hsk.chars.forEach(c=>CHARIDX.set(c.c,c));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet()});
  go('today');
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  loadStrokes();
}
boot();
